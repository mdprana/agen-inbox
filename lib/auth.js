import { cookies } from 'next/headers';
import { sessionStore } from './team-auth.js';
import { authorizeUrl } from './presentation.js';
export const SESSION_COOKIE = 'agen_session_v2';
export function config(env = process.env) {
  const missing = ['SESSION_SECRET', 'APP_URL'].filter(k => !env[k]);
  if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32) missing.push('SESSION_SECRET (minimal 32 karakter)');
  try { const u = new URL(env.APP_URL); if (env.APP_URL.endsWith('/') || u.username || u.password || u.pathname !== '/' || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost','127.0.0.1'].includes(u.hostname)))) throw new Error(); } catch { if (!missing.includes('APP_URL')) missing.push('APP_URL (HTTPS atau localhost)'); }
  return missing;
}
export function base() { return new URL(process.env.APP_URL).origin; }
export function cookieOptions(maxAge = 604800) { return {httpOnly:true, secure:base().startsWith('https:'), sameSite:'lax', path:'/', maxAge}; }
export async function readSession() {
  if (config().length) throw Object.assign(new Error('Silakan masuk.'), {status:401});
  return sessionStore().read((await cookies()).get(SESSION_COOKIE)?.value);
}
export const requireIdentity = readSession;
export async function setSession(profile) {
  return setSessionId(await sessionStore().create(profile));
}
export async function setSessionId(id) {
  const jar = await cookies();
  try {
    await sessionStore().remove(jar.get(SESSION_COOKIE)?.value);
    jar.set(SESSION_COOKIE, id, cookieOptions());
    jar.delete('agen_session');
  } catch (e) { await sessionStore().remove(id); throw e; }
}
export async function logout() {
  const jar = await cookies();
  try { await sessionStore().remove(jar.get(SESSION_COOKIE)?.value); }
  finally { jar.delete(SESSION_COOKIE); jar.delete('agen_session'); jar.delete('agen_oauth_v2'); jar.delete('agen_oauth'); }
}
export function checkOrigin(request) {
  if (config().length || request.headers.get('origin') !== base()) throw Object.assign(new Error('Origin permintaan ditolak.'), {status:403});
}
export async function jsonBody(request, max = 4096) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw Object.assign(new Error('Gunakan JSON.'), {status:415});
  if (Number(request.headers.get('content-length')) > max) throw new Error('Permintaan terlalu besar.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('JSON wajib diisi.');
  const chunks = []; let size = 0, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 5000);
  try {
    for (;;) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > max) { await reader.cancel(); throw new Error('Permintaan terlalu besar.'); } chunks.push(Buffer.from(value)); }
    if (timedOut) throw new Error();
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new Error('JSON tidak valid atau terlalu besar.'); }
  finally { clearTimeout(timer); reader.releaseLock(); }
}
export function authorizeResponse(redirect, provider) {
  const url = authorizeUrl(redirect.headers.get('location'), provider);
  if (!url) throw Object.assign(new Error('URL otorisasi tidak valid.'), {status:502});
  return Response.json({authorizeUrl:url}, {headers:{'Cache-Control':'no-store'}});
}
