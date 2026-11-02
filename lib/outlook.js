import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'node:crypto';
import { OUTLOOK_MAILBOX, email, inboxAlias, hasRecipient, renderContent, seal, unseal } from './helpers.js';
import { OUTLOOK_SCOPES, connectionStore, freshConnection, ownerConnect, outlookConnection } from './team-auth.js';
import { base, cookieOptions, config as authConfig, requireIdentity } from './auth.js';
import { redis, digest, storageConfig } from './redis.js';
import { requireSheets, readAgents } from './google.js';
const LOGIN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
export const STATE_COOKIE = 'agen_oauth_outlook_v2';
export const LIMITS = Object.freeze({top:100, pages:5, messages:50, parallel:5, body:100000, timeout:15000, deadline:45000, retries:2, retryAfter:5});
const fail = (message, status = 502) => Object.assign(new Error(message), {status});
const nonceKey = state => `agen:v2:oauth:outlook:${digest(state)}`;
const callbackUrl = () => base()+'/api/auth/outlook/callback';
export function outlookConfig(env = process.env) { return [...authConfig(env), ...['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'].filter(k => !env[k])]; }

export async function startOutlook() {
  const identity = await requireIdentity();
  ownerConnect(identity);
  if (outlookConfig().length || storageConfig().length) throw fail('Konfigurasi Outlook atau penyimpanan belum siap.', 503);
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  if (await redis()(['SET', nonceKey(state), digest(verifier), 'NX', 'PX', '600000']) !== 'OK') throw fail('OAuth tidak dapat dimulai.', 503);
  (await cookies()).set(STATE_COOKIE, seal({schema:2, provider:'microsoft', purpose:'outlook', mode:'connect', state, verifier, userId:identity.userId, sessionId:identity.sessionId, exp:Date.now()+600000}, process.env.SESSION_SECRET), cookieOptions(600));
  const params = new URLSearchParams({client_id:process.env.MICROSOFT_CLIENT_ID, response_type:'code', response_mode:'query', redirect_uri:callbackUrl(), scope:OUTLOOK_SCOPES.join(' '), state, code_challenge:createHash('sha256').update(verifier).digest('base64url'), code_challenge_method:'S256', prompt:'select_account', login_hint:OUTLOOK_MAILBOX});
  return Response.redirect(`${LOGIN}/authorize?${params}`);
}
export function validateOutlookState(state, params, identity) {
  if (!state || state.schema !== 2 || state.provider !== 'microsoft' || state.purpose !== 'outlook' || state.mode !== 'connect' || !/^[A-Za-z0-9_-]{43}$/.test(state.verifier) || !/^[A-Za-z0-9_-]{43}$/.test(state.state) || !Number.isFinite(state.exp) || state.exp <= Date.now() || state.exp > Date.now()+600000 || params.get('state') !== state.state || !params.get('code') || params.has('error')) throw new Error('Invalid OAuth state');
  ownerConnect(identity);
  if (!state.sessionId || state.sessionId !== identity.sessionId || state.userId !== identity.userId) throw new Error('OAuth identity changed');
}
export async function consumeOutlookState(state, command = redis()) {
  if (await command(['EVAL', "local v=redis.call('GET',KEYS[1]); if v == ARGV[1] then redis.call('DEL',KEYS[1]); return 1 else return 0 end", '1', nonceKey(state.state), digest(state.verifier)]) !== 1) throw new Error('OAuth state consumed or invalid');
}
export async function tokenRequest(params, fetcher = globalThis.fetch) {
  let response, data;
  try {
    response = await fetcher(`${LOGIN}/token`, {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({...params, scope:OUTLOOK_SCOPES.join(' '), client_id:process.env.MICROSOFT_CLIENT_ID, client_secret:process.env.MICROSOFT_CLIENT_SECRET}), cache:'no-store', signal:AbortSignal.timeout(20000)});
    data = await response.json();
  } catch { throw fail('Microsoft tidak dapat dihubungi.', 503); }
  if (!response.ok) throw fail('Microsoft menolak otorisasi. Pemilik harus hubungkan ulang Outlook.', 503);
  return data;
}
export function verifyMailbox(profile) {
  // ponytail: both mail and UPN must equal expected mailbox; null mail fails closed for manual diagnosis.
  if (typeof profile?.id !== 'string' || !profile.id.trim() || profile.id.length > 256 || [profile.mail, profile.userPrincipalName].some(v => typeof v !== 'string' || v.trim().toLowerCase() !== OUTLOOK_MAILBOX)) throw fail('Mailbox Outlook tidak sesuai.', 403);
  return profile.id;
}
export async function outlookCallback(request) {
  const jar = await cookies(), state = unseal(jar.get(STATE_COOKIE)?.value, process.env.SESSION_SECRET);
  jar.delete(STATE_COOKIE);
  try {
    if (outlookConfig().length) throw new Error();
    const params = new URL(request.url).searchParams, current = await requireIdentity();
    validateOutlookState(state, params, current);
    await consumeOutlookState(state);
    const tokens = await tokenRequest({grant_type:'authorization_code', code:params.get('code'), redirect_uri:callbackUrl(), code_verifier:state.verifier});
    const mailboxId = verifyMailbox(await graphGet(tokens.access_token, `${GRAPH}/me?$select=id,mail,userPrincipalName`));
    const value = outlookConnection(tokens, current, mailboxId), store = connectionStore(process.env, globalThis.fetch, 'outlook');
    await store.pin(mailboxId);
    const release = await store.lock();
    try { await store.write(value, release.nonce); } finally { await release(); }
    return Response.redirect(base()+'/');
  } catch { return Response.redirect(base()+'/?auth=outlook_failed'); }
}
export async function requireOutlook() {
  if (outlookConfig().length) throw fail('Konfigurasi Outlook belum siap.', 503);
  return freshConnection(connectionStore(process.env, globalThis.fetch, 'outlook'), tokenRequest);
}

export function graphUrl(value) {
  let u; try { u = new URL(value); } catch { throw fail('Tautan halaman Outlook tidak valid.'); }
  if (u.protocol !== 'https:' || u.hostname !== 'graph.microsoft.com' || u.port || u.username || u.password || u.hash || !(u.pathname === '/v1.0/me' || u.pathname.startsWith('/v1.0/me/'))) throw fail('Tautan halaman Outlook tidak valid.');
  return u.href;
}
export async function graphGet(token, url, {fetcher = globalThis.fetch, deadline = Date.now()+LIMITS.deadline} = {}) {
  const target = graphUrl(url);
  for (let attempt = 0; ; attempt++) {
    const left = deadline - Date.now();
    if (left <= 0) throw fail('Outlook terlalu lama merespons. Coba lagi.', 504);
    let response;
    try { response = await fetcher(target, {method:'GET', headers:{Authorization:`Bearer ${token}`, Accept:'application/json'}, cache:'no-store', redirect:'error', signal:AbortSignal.timeout(Math.min(LIMITS.timeout, left))}); }
    catch { throw fail('Outlook terlalu lama merespons atau tidak dapat dihubungi. Coba lagi.', 504); }
    if (response.status === 429) {
      const header = response.headers.get('retry-after'), wait = /^\d{1,3}$/.test(header || '') ? Number(header) : NaN;
      if (attempt >= LIMITS.retries || !Number.isInteger(wait) || wait > LIMITS.retryAfter || wait*1000 >= deadline - Date.now()) throw fail('Outlook membatasi permintaan. Coba lagi nanti.', 503);
      await new Promise(r => setTimeout(r, wait*1000));
      continue;
    }
    if (!response.ok) throw response.status === 401 ? fail('Akses Outlook kedaluwarsa. Pemilik harus hubungkan ulang Outlook.', 503) : fail('Microsoft Graph gagal. Periksa izin Outlook.');
    try { return await response.json(); } catch { throw fail('Respons Outlook tidak valid.'); }
  }
}
const address = value => { try { return email(value); } catch { return null; } };
export function recipientMatch(message, alias) {
  const listed = ['toRecipients', 'ccRecipients'].flatMap(k => Array.isArray(message?.[k]) ? message[k] : []).map(r => address(r?.emailAddress?.address));
  return listed.includes(alias) || hasRecipient(message?.internetMessageHeaders, alias);
}
export function requireAgent(rows, alias) {
  const count = rows.filter(r => r.email === alias).length;
  if (count !== 1) throw fail(count ? 'Alias duplikat di spreadsheet. Inbox tidak dibuka.' : 'Alias tidak terdaftar di spreadsheet.', count ? 409 : 404);
}
function present(message, body) {
  const date = new Date(message.receivedDateTime), valid = typeof message.receivedDateTime === 'string' && !Number.isNaN(date.getTime());
  const from = message.from?.emailAddress, fromName = typeof from?.name === 'string' ? from.name.slice(0, 256) : '', fromAddress = typeof from?.address === 'string' ? from.address.slice(0, 256) : '';
  const content = body?.id === message.id && typeof body?.body?.content === 'string' ? body.body.content.slice(0, LIMITS.body) : '';
  const html = body?.body?.contentType === 'html';
  return {id:message.id, subject:typeof message.subject === 'string' && message.subject ? message.subject.slice(0, 998) : '(Tanpa subjek)', from:fromName && fromAddress ? `${fromName} <${fromAddress}>` : fromAddress || fromName, date:valid ? date.toISOString() : '', ...renderContent(html ? [] : [content].filter(Boolean), html ? [content] : [])};
}
export async function scanMailbox(token, alias, fetcher = globalThis.fetch) {
  const deadline = Date.now()+LIMITS.deadline, seen = new Set(), matched = [];
  let limited = false, scanned = 0;
  for (const folder of ['inbox', 'junkemail']) {
    let url = `${GRAPH}/me/mailFolders/${folder}/messages?$top=${LIMITS.top}&$orderby=receivedDateTime%20desc&$select=id,subject,from,receivedDateTime,toRecipients,ccRecipients,internetMessageHeaders`;
    for (let page = 0; url; page++) {
      if (page >= LIMITS.pages || matched.length >= LIMITS.messages) { limited = true; break; }
      const data = await graphGet(token, url, {fetcher, deadline});
      if (!Array.isArray(data?.value) || data.value.length > LIMITS.top) throw fail('Respons Outlook tidak valid.');
      for (const m of data.value) {
        if (typeof m?.id !== 'string' || !m.id || m.id.length > 512 || seen.has(m.id)) continue;
        seen.add(m.id); scanned++;
        if (recipientMatch(m, alias)) matched.push(m);
      }
      const next = data['@odata.nextLink'];
      if (next !== undefined && next !== null && typeof next !== 'string') throw fail('Tautan halaman Outlook tidak valid.');
      url = next ? graphUrl(next) : null;
    }
  }
  const time = m => typeof m.receivedDateTime === 'string' && Date.parse(m.receivedDateTime) || 0;
  matched.sort((a, b) => time(b) - time(a));
  if (matched.length > LIMITS.messages) { limited = true; matched.length = LIMITS.messages; }
  const messages = [];
  for (let i = 0; i < matched.length; i += LIMITS.parallel) {
    const batch = matched.slice(i, i+LIMITS.parallel);
    const bodies = await Promise.all(batch.map(m => graphGet(token, `${GRAPH}/me/messages/${encodeURIComponent(m.id)}?$select=id,body`, {fetcher, deadline})));
    batch.forEach((m, j) => messages.push(present(m, bodies[j])));
  }
  return {messages, limited, scanned, coverage:'Inbox + Junk'};
}
export async function inbox(address) {
  await requireIdentity();
  const alias = inboxAlias(address);
  requireAgent(await readAgents(await requireSheets()), alias);
  return scanMailbox((await requireOutlook()).access_token, alias);
}
