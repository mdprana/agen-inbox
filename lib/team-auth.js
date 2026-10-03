import { OWNER, email, seal, unseal } from './helpers.js';
export const LOGIN_SCOPES = ['openid', 'email'];
export const DATA_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/spreadsheets'];
export const CONNECTION_LIFETIME = 180 * 86400000;
export function allowedEmail(address, env = process.env) {
  try { if (typeof address !== 'string' || email(address) !== address) return false; } catch { return false; }
  return address === OWNER || (env.TEAM_EMAILS ?? 'jderchild@gmail.com').split(',').map(s => s.trim()).includes(address);
}
export function identitySession(value, env = process.env) {
  if (!value || value.kind !== 'identity' || value.email_verified !== true || !value.sub || !allowedEmail(value.email, env) || !(value.exp > Date.now())) throw Object.assign(new Error('Silakan masuk dengan akun Google yang diizinkan.'), {status:401});
  return {kind:'identity', email:value.email, email_verified:true, sub:value.sub, exp:value.exp};
}
export function verifiedIdentity(value, env = process.env) {
  if (value?.email_verified !== true || typeof value.sub !== 'string' || !value.sub || !allowedEmail(value.email, env)) throw Object.assign(new Error('Akun Google tidak diizinkan.'), {status:403});
  return {kind:'identity', email:value.email, email_verified:true, sub:value.sub, exp:Date.now()+604800000};
}
export function ownerConnect(identity) {
  if (identity?.email !== OWNER) throw Object.assign(new Error('Hanya pemilik dapat menghubungkan Gmail dan Sheets.'), {status:403});
}
export function validateState(state, params, identity) {
  if (!state || !['login','connect'].includes(state.mode) || !state.verifier || !state.state || state.exp <= Date.now() || params.get('state') !== state.state || !params.get('code') || params.has('error')) throw new Error('Invalid OAuth state');
  if (state.mode === 'connect') { ownerConnect(identity); if (state.sub !== identity.sub) throw new Error('Connect identity changed'); }
  return state.mode;
}
function storageEnv(env) {
  return {...env, UPSTASH_REDIS_REST_URL:env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL, UPSTASH_REDIS_REST_TOKEN:env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN};
}
export function storageConfig(env = process.env) {
  env = storageEnv(env);
  const missing = ['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'].filter(k => !env[k]);
  if (env.UPSTASH_REDIS_REST_URL) {
    try { const u = new URL(env.UPSTASH_REDIS_REST_URL); if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) missing.push('UPSTASH_REDIS_REST_URL (HTTPS)'); } catch { missing.push('UPSTASH_REDIS_REST_URL (URL valid)'); }
  }
  return missing;
}
const reconnect = () => Object.assign(new Error('Koneksi Google pemilik belum siap atau kedaluwarsa. Pemilik harus masuk dan hubungkan ulang Gmail dan Sheets; token Testing dapat berakhir setelah 7 hari.'), {status:503});
export function connectionStore(env = process.env, fetcher = fetch) {
  env = storageEnv(env);
  async function command(args) {
    if (storageConfig(env).length) throw Object.assign(new Error('Penyimpanan koneksi Google belum siap. Hubungi pemilik.'), {status:503});
    try {
      const response = await fetcher(env.UPSTASH_REDIS_REST_URL.replace(/\/$/, ''), {method:'POST', headers:{Authorization:`Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type':'application/json'}, body:JSON.stringify(args), cache:'no-store', signal:AbortSignal.timeout(20000)});
      const data = await response.json();
      if (!response.ok || data.error) throw new Error('Storage error');
      return data.result;
    } catch { throw Object.assign(new Error('Penyimpanan koneksi Google tidak dapat diakses. Hubungi pemilik.'), {status:503}); }
  }
  const key = `agen:google:${OWNER}`;
  return {
    async read() {
      const value = unseal(await command(['GET', key]), env.SESSION_SECRET);
      if (!value || value.kind !== 'owner-connection' || value.email !== OWNER || !value.refresh_token || !value.access_token || !Number.isFinite(value.expires_at) || !Number.isFinite(value.exp) || value.exp > Date.now()+CONNECTION_LIFETIME) throw reconnect();
      return value;
    },
    async write(value) {
      if (value.kind !== 'owner-connection' || value.email !== OWNER || !value.refresh_token || !value.access_token || !Number.isFinite(value.expires_at) || !Number.isFinite(value.exp) || value.exp <= Date.now() || value.exp > Date.now()+CONNECTION_LIFETIME) throw reconnect();
      const result = await command(['SET', key, seal(value, env.SESSION_SECRET), 'PX', String(Math.ceil(value.exp-Date.now()))]);
      if (result !== 'OK') throw new Error('Koneksi Google gagal disimpan.');
    }
  };
}
export function ownerConnection(tokens) {
  if (!tokens.refresh_token || !tokens.access_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || !DATA_SCOPES.every(s => (tokens.scope || '').split(' ').includes(s))) throw reconnect();
  const lifetime = tokens.refresh_token_expires_in === undefined ? CONNECTION_LIFETIME : Math.min(CONNECTION_LIFETIME, Number(tokens.refresh_token_expires_in)*1000);
  if (!Number.isFinite(lifetime) || lifetime <= 0) throw reconnect();
  return {kind:'owner-connection', email:OWNER, access_token:tokens.access_token, refresh_token:tokens.refresh_token, expires_at:Date.now()+tokens.expires_in*1000, exp:Date.now()+lifetime};
}
export async function migrateLegacy(session, store, refresh, userinfo) {
  if (!session || session.kind || session.email !== OWNER || !session.refresh_token || !session.access_token || !Number.isFinite(session.expires_at) || !(session.exp > Date.now())) return null;
  const legacy = {kind:'owner-connection', email:OWNER, access_token:session.access_token, refresh_token:session.refresh_token, expires_at:session.expires_at, exp:Math.min(session.exp, Date.now()+CONNECTION_LIFETIME)};
  await freshConnection({read:async()=>legacy, write:async()=>{}}, refresh);
  const identity = verifiedIdentity(await userinfo(legacy));
  ownerConnect(identity);
  identity.exp = session.exp;
  let existing;
  try { existing = await store.read(); } catch (e) { if (e.status !== 503 || !e.message.startsWith('Koneksi Google pemilik')) throw e; }
  if (!existing) await store.write(legacy);
  return identity;
}
export async function freshConnection(store, refresh) {
  const value = await store.read();
  if (value.expires_at <= Date.now()+60000) {
    let tokens;
    try { tokens = await refresh({grant_type:'refresh_token', refresh_token:value.refresh_token}); } catch { throw reconnect(); }
    if (!tokens.access_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw reconnect();
    value.access_token = tokens.access_token;
    value.expires_at = Date.now()+tokens.expires_in*1000;
    if (tokens.refresh_token) value.refresh_token = tokens.refresh_token;
    if (tokens.refresh_token_expires_in !== undefined) value.exp = Math.min(value.exp, Date.now()+Number(tokens.refresh_token_expires_in)*1000);
    await store.write(value);
  }
  return value;
}
