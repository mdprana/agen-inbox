import { randomBytes } from 'node:crypto';
import { seal, unseal, OWNER } from './helpers.js';
import { redis, digest, lock, storageConfig } from './redis.js';
export { storageConfig } from './redis.js';
export const LOGIN_SCOPES = ['openid', 'email'];
export const DATA_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
export const CONNECTION_LIFETIME = 180 * 86400000;
export const TEAM = Object.freeze(['aprilliawanda13@gmail.com', 'ekonduttt@gmail.com', 'lintangh9@gmail.com', 'madepranajaya01@gmail.com']);
export function allowedEmail(address) { return TEAM.includes(address); }
const denied = () => Object.assign(new Error('Silakan masuk dengan akun yang diizinkan.'), {status:401});
export function verifiedIdentity(value) {
  if (value?.email_verified !== true || typeof value.sub !== 'string' || !value.sub.trim() || value.sub.length > 255 || !allowedEmail(value.email)) throw Object.assign(new Error('Akun Google tidak diizinkan.'), {status:403});
  return {email:value.email, sub:value.sub};
}
export function identitySession(value) {
  if (!value || value.schema !== 2 || value.kind !== 'session' || !allowedEmail(value.email) || value.userId !== value.email || !['google','password'].includes(value.authMethod) || typeof value.sub !== 'string' || !value.sub.trim() || !Number.isSafeInteger(value.authVersion) || value.authVersion < 1 || !Number.isFinite(value.created) || value.created > Date.now() || !Number.isFinite(value.exp) || value.exp <= Date.now() || value.exp > value.created + 604800000) throw denied();
  return {schema:2, kind:'session', userId:value.userId, email:value.email, authMethod:value.authMethod, sub:value.sub, authVersion:value.authVersion, created:value.created, exp:value.exp};
}
export function sessionStore(env = process.env, fetcher = fetch) {
  const command = redis(env, fetcher);
  const key = id => `agen:v2:session:${digest(id)}`;
  const userKey = address => `agen:v2:user:${digest(address)}`;
  async function saveSession(existing, authMethod, sub) {
    const id = randomBytes(32).toString('base64url'), created = Date.now();
    const session = identitySession({schema:2, kind:'session', userId:existing.email, email:existing.email, authMethod, sub, authVersion:existing.authVersion, created, exp:created+604800000});
    if (await command(['SET', key(id), JSON.stringify(session), 'PX', String(session.exp-Date.now()), 'NX']) !== 'OK') throw denied();
    return id;
  }
  async function user(address) {
    let value;
    try { value = JSON.parse(await command(['GET', userKey(address)])); } catch (e) { if (e.status) throw e; }
    if (!value || value.schema !== 2 || value.userId !== address || value.email !== address || !allowedEmail(address) || !(value.googleSub === null || (typeof value.googleSub === 'string' && value.googleSub.trim() && value.googleSub.length <= 255)) || !Number.isSafeInteger(value.authVersion) || value.authVersion < 1) throw denied();
    return value;
  }
  return {
    async create(profile) {
      const identity = verifiedIdentity(profile);
      const record = {schema:2, userId:identity.email, email:identity.email, googleSub:identity.sub, authVersion:1};
      const result = await command(['SET', userKey(identity.email), JSON.stringify(record), 'NX']);
      if (result !== null && result !== 'OK') throw denied();
      const existing = await user(identity.email);
      if (existing.googleSub !== identity.sub) throw denied();
      return saveSession(existing, 'google', identity.sub);
    },
    async createPassword(address, authVersion) {
      if (env.PASSWORD_LOGIN_ENABLED !== 'true') throw denied();
      const existing = await user(address);
      if (!existing.password || existing.authVersion !== authVersion) throw denied();
      return saveSession(existing, 'password', address);
    },
    async read(id) {
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id)) throw denied();
      let raw;
      try { raw = JSON.parse(await command(['GET', key(id)])); } catch (e) { if (e.status) throw e; throw denied(); }
      const session = identitySession(raw), record = await user(session.email);
      if (record.authVersion !== session.authVersion || (session.authMethod === 'google' ? record.googleSub !== session.sub : env.PASSWORD_LOGIN_ENABLED !== 'true' || !record.password || session.sub !== record.email)) throw denied();
      return {...session, sessionId:id};
    },
    async remove(id) { if (typeof id === 'string' && /^[A-Za-z0-9_-]{43}$/.test(id)) await command(['DEL', key(id)]); },
    async revokeAll(address) {
      if (!allowedEmail(address)) throw denied();
      const result = await command(['EVAL', "local v=redis.call('GET',KEYS[1]); if not v then return 0 end; local u=cjson.decode(v); u.authVersion=u.authVersion+1; redis.call('SET',KEYS[1],cjson.encode(u)); return 1", '1', userKey(address)]);
      if (result !== 1) throw denied();
    },
    async ownerBinding(identity, sub) {
      ownerConnect(identity);
      const record = await user(identity.email);
      if (record.googleSub !== sub) throw denied();
    }
  };
}
export function ownerConnect(identity) {
  if (identity?.email !== OWNER || identity.userId !== OWNER) throw Object.assign(new Error('Hanya pemilik dapat menghubungkan layanan.'), {status:403});
}
export function validateState(state, params, identity) {
  if (!state || state.schema !== 2 || state.provider !== 'google' || state.purpose !== (state.mode === 'connect' ? 'sheets' : 'identity') || !['login','connect'].includes(state.mode) || !/^[A-Za-z0-9_-]{43}$/.test(state.verifier) || !/^[A-Za-z0-9_-]{43}$/.test(state.state) || !Number.isFinite(state.exp) || state.exp <= Date.now() || state.exp > Date.now()+600000 || params.get('state') !== state.state || !params.get('code') || params.has('error')) throw new Error('Invalid OAuth state');
  if (state.mode === 'connect') ownerConnect(identity);
  if ((state.sessionId || null) !== (identity?.sessionId || null) || (state.userId || null) !== (identity?.userId || null)) throw new Error('OAuth identity changed');
  return state.mode;
}
const PROVIDERS = {sheets:{provider:'google', email:OWNER, label:'Sheets'}};
const reconnect = (purpose = 'sheets') => Object.assign(new Error(`Koneksi ${PROVIDERS[purpose].label} pemilik belum siap. Pemilik harus hubungkan ulang ${PROVIDERS[purpose].label}.`), {status:503});
function validateConnection(value, purpose = 'sheets') {
  const p = PROVIDERS[purpose];
  if (!p || !value || value.schema !== 2 || value.kind !== 'connection' || value.provider !== p.provider || value.purpose !== purpose || value.owner !== OWNER || value.email !== p.email || typeof value.sub !== 'string' || !value.sub.trim() || typeof value.refresh_token !== 'string' || !value.refresh_token || typeof value.access_token !== 'string' || !value.access_token || !Number.isFinite(value.expires_at) || !Number.isFinite(value.exp) || value.exp <= Date.now() || value.exp > Date.now()+CONNECTION_LIFETIME) throw reconnect(purpose);
  return value;
}
export function connectionStore(env = process.env, fetcher = fetch, purpose = 'sheets') {
  if (!PROVIDERS[purpose]) throw new Error('Invalid connection purpose');
  const command = redis(env, fetcher), sessions = sessionStore(env, fetcher), key = `agen:v2:connection:${purpose}`;
  async function validate(value) {
    validateConnection(value, purpose);
    await sessions.ownerBinding({email:OWNER, userId:OWNER}, value.sub);
    return value;
  }
  return {
    purpose,
    async read() { return validate(unseal(await command(['GET', key]), env.SESSION_SECRET)); },
    async write(value, nonce) {
      await validate(value);
      const sealed = seal(value, env.SESSION_SECRET), ttl = String(Math.ceil(value.exp-Date.now()));
      const result = nonce
        ? await command(['EVAL', "if redis.call('GET',KEYS[2]) ~= ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2],'PX',ARGV[3]); return 1", '2', key, `${key}:lock`, nonce, sealed, ttl])
        : await command(['SET', key, sealed, 'PX', ttl]);
      if (result !== (nonce ? 1 : 'OK')) throw reconnect(purpose);
    },
    async lock() { return lock(command, `${key}:lock`); }
  };
}
export function ownerConnection(tokens, identity) {
  ownerConnect(identity);
  if (typeof identity.sub !== 'string' || !identity.sub.trim() || !tokens.refresh_token || !tokens.access_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || !DATA_SCOPES.every(s => (tokens.scope || '').split(' ').includes(s))) throw reconnect();
  const lifetime = tokens.refresh_token_expires_in === undefined ? CONNECTION_LIFETIME : Math.min(CONNECTION_LIFETIME, Number(tokens.refresh_token_expires_in)*1000);
  if (!Number.isFinite(lifetime) || lifetime <= 0) throw reconnect();
  return validateConnection({schema:2, kind:'connection', provider:'google', purpose:'sheets', owner:OWNER, email:OWNER, sub:identity.sub, access_token:tokens.access_token, refresh_token:tokens.refresh_token, expires_at:Date.now()+tokens.expires_in*1000, exp:Date.now()+lifetime});
}
export async function freshConnection(store, refresh) {
  const purpose = store.purpose || 'sheets';
  let value = await store.read();
  if (value.expires_at > Date.now()+60000) return value;
  const release = await store.lock();
  try {
    value = await store.read();
    if (value.expires_at > Date.now()+60000) return value;
    let tokens;
    try { tokens = await refresh({grant_type:'refresh_token', refresh_token:value.refresh_token}); } catch { throw reconnect(purpose); }
    if (typeof tokens.access_token !== 'string' || !tokens.access_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || (tokens.refresh_token !== undefined && (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token))) throw reconnect(purpose);
    const next = {...value, access_token:tokens.access_token, expires_at:Date.now()+tokens.expires_in*1000, refresh_token:tokens.refresh_token || value.refresh_token};
    if (tokens.refresh_token_expires_in !== undefined) next.exp = Math.min(value.exp, Date.now()+Number(tokens.refresh_token_expires_in)*1000);
    validateConnection(next, purpose);
    await store.write(next, release.nonce);
    return next;
  } finally { await release(); }
}
