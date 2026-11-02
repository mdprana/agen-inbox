import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'node:crypto';
import { OWNER, DEFAULT_SHEET, seal, parseRows, uniqueRow, sheetRange, column } from './helpers.js';
import { connectionStore, freshConnection, storageConfig, LOGIN_SCOPES, DATA_SCOPES, ownerConnect } from './team-auth.js';
import { base, cookieOptions, config as authConfig, requireIdentity } from './auth.js';
import { redis, digest } from './redis.js';
export { base, cookieOptions, readSession, setSession, checkOrigin } from './auth.js';
export function config() {
  return [...authConfig(), ...['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter(k => !process.env[k])];
}
export async function startOAuth(mode, hint) {
  if (!['login','connect'].includes(mode)) throw new Error('Invalid OAuth mode');
  let identity = null;
  if (mode === 'connect') { identity = await requireIdentity(); ownerConnect(identity); }
  if (config().length || storageConfig().length) throw Object.assign(new Error('Konfigurasi OAuth atau penyimpanan belum siap.'), {status:503});
  const jar = await cookies();
  if (mode === 'login' && jar.get('agen_session_v2')?.value) identity = await requireIdentity();
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  const value = {schema:2, provider:'google', purpose:mode === 'connect' ? 'sheets' : 'identity', mode, state, verifier, userId:identity?.userId, sessionId:identity?.sessionId, exp:Date.now()+600000};
  if (await redis()(['SET', `agen:v2:oauth:${digest(state)}`, digest(verifier), 'NX', 'PX', '600000']) !== 'OK') throw new Error('OAuth tidak dapat dimulai.');
  jar.set('agen_oauth_v2', seal(value, process.env.SESSION_SECRET), cookieOptions(600));
  const params = new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID, redirect_uri:base()+'/api/auth/callback', response_type:'code', scope:(mode === 'connect' ? [...LOGIN_SCOPES, ...DATA_SCOPES] : LOGIN_SCOPES).join(' '), state, code_challenge:createHash('sha256').update(verifier).digest('base64url'), code_challenge_method:'S256', prompt:mode === 'connect' ? 'consent' : 'select_account'});
  if (mode === 'connect') { params.set('access_type','offline'); params.set('login_hint',OWNER); }
  return Response.redirect('https://accounts.google.com/o/oauth2/v2/auth?'+params);
}
export async function consumeState(state, command = redis()) {
  const result = await command(['EVAL', "local v=redis.call('GET',KEYS[1]); if v == ARGV[1] then redis.call('DEL',KEYS[1]); return 1 else return 0 end", '1', `agen:v2:oauth:${digest(state.state)}`, digest(state.verifier)]);
  if (result !== 1) throw new Error('OAuth state consumed or invalid');
}
export async function tokenRequest(params) {
  const response = await fetch('https://oauth2.googleapis.com/token', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({...params, client_id:process.env.GOOGLE_CLIENT_ID, client_secret:process.env.GOOGLE_CLIENT_SECRET}), cache:'no-store', signal:AbortSignal.timeout(20000)});
  const data = await response.json();
  if (!response.ok) throw new Error('Google menolak otorisasi. Periksa konfigurasi OAuth.');
  return data;
}
export async function requireSheets() {
  const identity = await requireIdentity();
  if (config().length) throw Object.assign(new Error('Konfigurasi Sheets belum siap.'), {status:503});
  const connection = await freshConnection(connectionStore(), tokenRequest);
  return {...identity, access_token:connection.access_token};
}
export async function google(session, url, options = {}) {
  const response = await fetch(url, {...options, headers:{...options.headers, Authorization:`Bearer ${session.access_token}`}, cache:'no-store', signal:AbortSignal.timeout(25000)});
  if (!response.ok) throw Object.assign(new Error(response.status === 401 ? 'Akses Sheets kedaluwarsa. Pemilik harus hubungkan ulang Sheets.' : 'Google API gagal. Periksa izin dan akses Sheets.'), {status:response.status === 401 ? 503 : 502});
  return response.json();
}
function sheetUrl() { return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(process.env.SPREADSHEET_ID || DEFAULT_SHEET)}`; }
export async function readAgents(session) {
  const metadata = await google(session, `${sheetUrl()}?fields=sheets.properties.title`);
  const titles = metadata.sheets.map(s => s.properties.title), rows = [];
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i+20), params = new URLSearchParams({valueRenderOption:'FORMATTED_VALUE'});
    batch.forEach(t => params.append('ranges', sheetRange(t, 'A:ZZZ')));
    const data = await google(session, `${sheetUrl()}/values:batchGet?${params}`);
    batch.forEach((title, j) => rows.push(...parseRows(title, data.valueRanges[j]?.values || [])));
  }
  return rows;
}
export async function writeStatus(session, address, status) {
  if (!['BERHASIL','GAGAL'].includes(status)) throw Object.assign(new Error('Status harus BERHASIL atau GAGAL.'), {status:400});
  const row = uniqueRow(await readAgents(session), address), range = sheetRange(row.sheet, `${column(row.statusColumn)}${row.row}`);
  await google(session, `${sheetUrl()}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({range, majorDimension:'ROWS', values:[[status]]})});
  return {email:row.email, status};
}
export function errorResponse(error) { return Response.json({error:error.status ? error.message : 'Permintaan gagal.'}, {status:error.status || 400, headers:{'Cache-Control':'no-store'}}); }
