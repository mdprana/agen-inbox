import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { allowedEmail, sessionStore } from './team-auth.js';
import { OWNER } from './helpers.js';
import { redis, digest, PASSWORD_LIMIT, PASSWORD_ADMIT, PASSWORD_UPDATE } from './redis.js';
export const SCRYPT = Object.freeze({N:131072, r:8, p:1, maxmem:256*1024*1024});
const derive = promisify(scrypt), prefix = 'agen:v2:password:';
const invalid = () => Object.assign(new Error('Kredensial tidak valid.'), {status:401});
const unavailable = () => Object.assign(new Error('Autentikasi kata sandi belum siap.'), {status:503});
const busy = () => Object.assign(new Error('Coba lagi nanti.'), {status:429});
export function passwordEnabled(env = process.env) { return env.PASSWORD_LOGIN_ENABLED === 'true'; }
export function requirePassword(env = process.env) { if (!passwordEnabled(env)) throw unavailable(); }
export function passwordInput(value) {
  if (typeof value !== 'string' || [...value].length < 15 || Buffer.byteLength(value, 'utf8') > 128 || /[\uD800-\uDFFF]/u.test(value)) throw invalid();
  return value;
}
export function passwordRecord(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'N,key,maxmem,p,r,salt,version' || value.version !== 1 || !Object.entries(SCRYPT).every(([k,v]) => value[k] === v) || typeof value.salt !== 'string' || typeof value.key !== 'string' || !/^[a-f0-9]{32}$/.test(value.salt) || !/^[a-f0-9]{128}$/.test(value.key)) throw invalid();
  return value;
}
export async function hashPassword(value) {
  passwordInput(value);
  const salt = randomBytes(16).toString('hex');
  return {version:1, ...SCRYPT, salt, key:(await derive(value, Buffer.from(salt, 'hex'), 64, SCRYPT)).toString('hex')};
}
export async function verifyPassword(value, record) {
  passwordInput(value); passwordRecord(record);
  return timingSafeEqual(await derive(value, Buffer.from(record.salt, 'hex'), 64, SCRYPT), Buffer.from(record.key, 'hex'));
}
const dummy = Object.freeze({version:1, ...SCRYPT, salt:'45'.repeat(16), key:'00'.repeat(64)});
let inflight = false;
export async function admittedHash(command, work) {
  if (inflight) throw busy();
  inflight = true;
  const nonce = randomBytes(32).toString('base64url'), key = prefix+'inflight';
  let admitted = false;
  try {
    if (await command(['EVAL', PASSWORD_ADMIT, '1', key, nonce]) !== 1) throw busy();
    admitted = true;
    return await work();
  } finally {
    try { if (admitted && await command(['ZREM', key, nonce]) !== 1) throw unavailable(); }
    finally { inflight = false; }
  }
}
export function trustedIP(request, env = process.env) {
  const ip = request.headers.get('x-vercel-forwarded-for');
  if (env.VERCEL !== '1' || typeof ip !== 'string' || !isIP(ip)) throw unavailable();
  return isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname.slice(1,-1) : ip;
}
export function adminRequest(request, env = process.env) {
  const secret = env.INVITE_ADMIN_SECRET, match = /^Bearer (.+)$/.exec(request.headers.get('authorization') || '');
  if (!match || typeof secret !== 'string' || secret.length < 32) return false;
  const hash = value => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(hash(match[1]), hash(secret))) throw invalid();
  return true;
}
function addressInput(value) { return typeof value === 'string' && value.length <= 254 ? value.trim().toLowerCase() : ''; }
export function recentIdentity(identity, google = false, env = process.env) {
  if (!identity || !allowedEmail(identity.email, env) || identity.userId !== identity.email || !Number.isFinite(identity.created) || identity.created > Date.now() || identity.created < Date.now()-600000 || (google && identity.authMethod !== 'google')) throw invalid();
}
export function passwordStore(env = process.env, fetcher = fetch) {
  const command = redis(env, fetcher), sessions = sessionStore(env, fetcher);
  const userKey = address => `agen:v2:user:${digest(address)}`;
  async function rawUser(address) {
    const raw = await command(['GET', userKey(address)]);
    if (!raw) return {raw:null, user:null};
    let user;
    try { user = JSON.parse(raw); } catch { throw invalid(); }
    if (!user || user.schema !== 2 || user.email !== address || user.userId !== address || !allowedEmail(address, env) || !Number.isSafeInteger(user.authVersion) || user.authVersion < 1 || !(user.googleSub === null || (typeof user.googleSub === 'string' && user.googleSub.trim() && user.googleSub.length <= 255))) throw invalid();
    return {raw, user};
  }
  async function limit(address, ip, purpose) {
    const nonce = randomBytes(32).toString('base64url');
    const keys = [prefix+purpose+':account:'+digest(address), prefix+purpose+':ip:'+digest(ip)];
    if (await command(['EVAL', PASSWORD_LIMIT, '2', ...keys, nonce]) !== 1) throw busy();
    return async () => { if (await command(['ZREM', keys[0], nonce]) !== 1) throw unavailable(); };
  }
  async function update(address, expected, password, tokenKey = prefix+'unused', tokenRaw = '') {
    const user = expected.user || {schema:2, userId:address, email:address, googleSub:null, authVersion:1};
    const next = {...user, password, authVersion:user.authVersion+1};
    if (await command(['EVAL', PASSWORD_UPDATE, '2', userKey(address), tokenKey, expected.raw || '', JSON.stringify(next), tokenRaw]) !== 1) throw invalid();
  }
  return {
    async user(address) { return (await rawUser(address)).user; },
    async login(address, password, ip) {
      requirePassword(env);
      address = addressInput(address); passwordInput(password);
      const success = await limit(address, ip, 'login');
      const {user} = allowedEmail(address, env) ? await rawUser(address) : {user:null};
      let record = dummy, usable = false;
      try { if (user?.password) { record = passwordRecord(user.password); usable = true; } } catch {}
      const matches = await admittedHash(command, () => verifyPassword(password, record));
      if (!usable || !matches) throw invalid();
      const id = await sessions.createPassword(address, user.authVersion);
      try { await success(); return id; } catch (e) { await sessions.remove(id); throw e; }
    },
    async enroll(identity, password, ip) {
      requirePassword(env); recentIdentity(identity, true, env);
      await limit(identity.email, ip, 'enroll'); passwordInput(password);
      const expected = await rawUser(identity.email);
      if (!expected.user || expected.user.password || expected.user.googleSub !== identity.sub || expected.user.authVersion !== identity.authVersion) throw invalid();
      const hash = await admittedHash(command, () => hashPassword(password));
      await update(identity.email, expected, hash);
    },
    async issue(identity, address, purpose, ip, {admin = false} = {}) {
      requirePassword(env);
      if (!['invite','reset'].includes(purpose)) throw invalid();
      const ownerError = (msg, status = 409) => Object.assign(new Error(msg), {status});
      if (!admin) try { recentIdentity(identity, false, env); if (identity.email !== OWNER) return null; } catch {
        if (identity?.email === OWNER && allowedEmail(OWNER, env)) throw ownerError('Sesi Google pemilik lebih dari 10 menit. Keluar, masuk lagi dengan Google, lalu buat tautan.', 403);
        return null;
      }
      address = addressInput(address);
      await limit(admin ? 'admin' : identity.email, ip, 'issue');
      if (!allowedEmail(address, env)) throw ownerError('Email ini belum ada di daftar tim.');
      if (!admin && address === OWNER) throw ownerError('Akun pemilik tidak bisa diundang.');
      const expected = await rawUser(address);
      if (purpose === 'invite' && expected.user?.password) throw ownerError('Akun ini sudah punya kata sandi. Pilih Reset.');
      if (purpose === 'reset' && !expected.user?.password) throw ownerError('Akun ini belum punya kata sandi. Pilih Undangan.');
      const token = randomBytes(32).toString('base64url');
      const value = {schema:1, purpose, userId:address, authVersion:expected.user?.authVersion || 0, exp:Date.now()+1800000};
      if (await command(['SET', prefix+'token:'+digest(token), JSON.stringify(value), 'NX', 'PX', '1800000']) !== 'OK') throw unavailable();
      return token;
    },
    async consume(address, token, purpose, password, ip) {
      requirePassword(env);
      address = addressInput(address);
      await limit(address, ip, 'consume'); passwordInput(password);
      if (!allowedEmail(address, env) || !['invite','reset'].includes(purpose) || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalid();
      const key = prefix+'token:'+digest(token), raw = await command(['GET', key]);
      let value;
      try { value = JSON.parse(raw); } catch { throw invalid(); }
      const expected = await rawUser(address);
      if (!value || Object.keys(value).sort().join(',') !== 'authVersion,exp,purpose,schema,userId' || value.schema !== 1 || value.purpose !== purpose || value.userId !== address || !Number.isFinite(value.exp) || value.exp <= Date.now() || value.exp > Date.now()+1800000 || value.authVersion !== (expected.user?.authVersion || 0) || (purpose === 'invite' ? !!expected.user?.password : !expected.user?.password)) throw invalid();
      const hash = await admittedHash(command, () => hashPassword(password));
      await update(address, expected, hash, key, raw);
    }
  };
}
