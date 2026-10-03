import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'node:crypto';
import { OWNER, DEFAULT_SHEET, seal, unseal, parseRows, uniqueRow, sheetRange, column, ownedAlias, hasRecipient, messageContent } from './helpers.js';
import { identitySession, connectionStore, freshConnection, storageConfig, migrateLegacy, LOGIN_SCOPES, DATA_SCOPES, ownerConnect } from './team-auth.js';
export function config() {
  const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET', 'APP_URL'].filter(k => !process.env[k]);
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) missing.push('SESSION_SECRET (minimal 32 karakter)');
  try { const u = new URL(process.env.APP_URL); if (process.env.APP_URL.endsWith('/') || u.username || u.password || u.pathname !== '/' || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost','127.0.0.1'].includes(u.hostname)))) missing.push('APP_URL (HTTPS atau localhost)'); } catch { if (!missing.includes('APP_URL')) missing.push('APP_URL (URL valid)'); }
  return missing;
}
export function base() { return new URL(process.env.APP_URL).origin; }
export function cookieOptions(maxAge = 604800) { return {httpOnly: true, secure: base().startsWith('https:'), sameSite: 'lax', path: '/', maxAge}; }
export async function setSession(session) {
  const value = seal(identitySession(session), process.env.SESSION_SECRET);
  if (value.length > 3800) throw new Error('Sesi terlalu besar. Login ulang.');
  (await cookies()).set('agen_session', value, cookieOptions());
}
export async function readSession() {
  return unseal((await cookies()).get('agen_session')?.value, process.env.SESSION_SECRET);
}
export async function startOAuth(mode) {
  if (config().length) throw Object.assign(new Error('Konfigurasi OAuth belum siap.'), {status:503});
  let identity;
  if (mode === 'connect') {
    identity = identitySession(await readSession());
    ownerConnect(identity);
    if (storageConfig().length) throw Object.assign(new Error('Penyimpanan koneksi Google belum siap.'), {status:503});
  }
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  (await cookies()).set('agen_oauth', seal({mode, state, verifier, sub:identity?.sub, exp:Date.now()+600000}, process.env.SESSION_SECRET), cookieOptions(600));
  const params = new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID, redirect_uri:base()+'/api/auth/callback', response_type:'code', scope:(mode === 'connect' ? [...LOGIN_SCOPES, ...DATA_SCOPES] : LOGIN_SCOPES).join(' '), state, code_challenge:createHash('sha256').update(verifier).digest('base64url'), code_challenge_method:'S256', prompt:mode === 'connect' ? 'consent' : 'select_account'});
  if (mode === 'connect') { params.set('access_type','offline'); params.set('login_hint',OWNER); }
  return Response.redirect('https://accounts.google.com/o/oauth2/v2/auth?'+params);
}
export async function tokenRequest(params) {
  const response = await fetch('https://oauth2.googleapis.com/token', {method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({...params, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET}), cache: 'no-store', signal: AbortSignal.timeout(20000)});
  const data = await response.json();
  if (!response.ok) throw new Error('Google menolak otorisasi. Login ulang atau periksa konfigurasi OAuth.');
  return data;
}
export async function requireSession() {
  if (config().length) throw Object.assign(new Error('Konfigurasi OAuth belum siap.'), {status:401});
  let session = await readSession();
  const store = connectionStore();
  // Only legacy owner cookies minted by previous verified-owner callback qualify.
  if (session && !session.kind && session.email === OWNER && session.refresh_token && session.access_token && Number.isFinite(session.expires_at)) {
    if (storageConfig().length) throw Object.assign(new Error('Penyimpanan koneksi Google belum siap. Hubungi pemilik.'), {status:503});
    session = await migrateLegacy(session, store, tokenRequest, value=>google(value, 'https://openidconnect.googleapis.com/v1/userinfo'));
    await setSession(session);
  }
  const identity = identitySession(session);
  const connection = await freshConnection(store, tokenRequest);
  return {...identity, access_token:connection.access_token};
}
export function checkOrigin(request) {
  if (request.headers.get('origin') !== base()) throw Object.assign(new Error('Origin permintaan ditolak.'), {status:403});
}
export async function google(session, url, options = {}) {
  const response = await fetch(url, {...options, headers: {...options.headers, Authorization:`Bearer ${session.access_token}`}, cache:'no-store', signal: AbortSignal.timeout(25000)});
  if (!response.ok) throw Object.assign(new Error(response.status === 401 ? 'Akses Google kedaluwarsa. Pemilik harus hubungkan ulang Gmail dan Sheets.' : 'Google API gagal. Periksa izin Gmail, Sheets, dan akses spreadsheet.'), {status:response.status === 401 ? 401 : 502});
  return response.json();
}
function sheetUrl() { return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(process.env.SPREADSHEET_ID || DEFAULT_SHEET)}`; }
export async function readAgents(session) {
  const metadata = await google(session, `${sheetUrl()}?fields=sheets.properties.title`);
  const titles = metadata.sheets.map(s => s.properties.title);
  const rows = [];
  // Read whole used grid, every sheet. No persisted copies of agent data.
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i + 20);
    const params = new URLSearchParams({valueRenderOption:'FORMATTED_VALUE'});
    batch.forEach(t => params.append('ranges', sheetRange(t, 'A:ZZZ')));
    const data = await google(session, `${sheetUrl()}/values:batchGet?${params}`);
    batch.forEach((title, j) => rows.push(...parseRows(title, data.valueRanges[j]?.values || [])));
  }
  return rows;
}
export async function writeStatus(session, address, status) {
  if (!['BERHASIL','GAGAL'].includes(status)) throw Object.assign(new Error('Status harus BERHASIL atau GAGAL.'), {status:400});
  const row = uniqueRow(await readAgents(session), address);
  const range = sheetRange(row.sheet, `${column(row.statusColumn)}${row.row}`);
  // ponytail: re-read handles pre-submit sorts; Google Sheets has no conditional cell update. Do not sort during save.
  await google(session, `${sheetUrl()}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({range, majorDimension:'ROWS', values:[[status]]})});
  return {email:row.email, status};
}
export async function inbox(session, address) {
  const alias = ownedAlias(address);
  const params = new URLSearchParams({q:`in:anywhere (to:${alias} OR cc:${alias} OR deliveredto:${alias})`, maxResults:'50'});
  const list = await google(session, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
  const messages = [];
  for (let i = 0; i < (list.messages || []).length; i += 5) {
    const batch = await Promise.all(list.messages.slice(i, i+5).map(m => google(session, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?format=full`)));
    for (const m of batch) {
      const headers = m.payload.headers || [];
      if (!hasRecipient(headers, alias)) continue;
      const get = name => headers.find(h => h.name.toLowerCase() === name)?.value || '';
      messages.push({id:m.id, subject:get('subject') || '(Tanpa subjek)', from:get('from'), date:new Date(Number(m.internalDate)).toISOString(), ...messageContent(m.payload)});
    }
  }
  return {messages:messages.sort((a,b) => b.date.localeCompare(a.date)), limited:Boolean(list.nextPageToken)};
}
export function errorResponse(error) { return Response.json({error:error.message || 'Permintaan gagal.'}, {status:error.status || 400, headers:{'Cache-Control':'no-store'}}); }
