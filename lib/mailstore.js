import { inboxAlias, renderContent } from './helpers.js';
import { requireIdentity } from './auth.js';
import { requireSheets, readAgents } from './google.js';
export const LIMITS = Object.freeze({messages:50, body:100000, timeout:15000});
const fail = (message, status = 502) => Object.assign(new Error(message), {status});

export function mailConfig(env = process.env) {
  const missing = [];
  try {
    const u = new URL(env.MAIL_WORKER_URL);
    if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash || env.MAIL_WORKER_URL.endsWith('/')) throw new Error();
  } catch { missing.push('MAIL_WORKER_URL'); }
  if (!env.MAIL_WORKER_TOKEN) missing.push('MAIL_WORKER_TOKEN');
  return missing;
}
export function requireAgent(rows, alias) {
  const count = rows.filter(r => r.email === alias).length;
  if (count !== 1) throw fail(count ? 'Alias duplikat di spreadsheet. Inbox tidak dibuka.' : 'Alias tidak terdaftar di spreadsheet.', count ? 409 : 404);
}
const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
export function present(m) {
  const date = new Date(m.date), valid = typeof m.date === 'string' && !Number.isNaN(date.getTime());
  const name = str(m.from?.name, 256), address = str(m.from?.address, 256), html = str(m.html, LIMITS.body), text = str(m.text, LIMITS.body);
  return {id:m.id, subject:str(m.subject, 998) || '(Tanpa subjek)', from:(name && address ? `${name} <${address}>` : address || name).slice(0, 256), date:valid ? date.toISOString() : '', ...renderContent(html ? [] : [text].filter(Boolean), html ? [html] : [])};
}
export async function fetchMessages(alias, {fetcher = globalThis.fetch, env = process.env} = {}) {
  alias = inboxAlias(alias);
  if (mailConfig(env).length) throw fail('Konfigurasi sumber email belum siap.', 503);
  let response, data;
  try {
    response = await fetcher(`${env.MAIL_WORKER_URL}/messages?${new URLSearchParams({alias})}`, {method:'GET', headers:{Authorization:`Bearer ${env.MAIL_WORKER_TOKEN}`, Accept:'application/json'}, cache:'no-store', redirect:'error', signal:AbortSignal.timeout(LIMITS.timeout)});
  } catch { throw fail('Sumber email terlalu lama merespons atau tidak dapat dihubungi. Coba lagi.', 503); }
  if (response.status === 401) throw fail('Akses sumber email ditolak. Pemilik harus memeriksa token Worker.', 503);
  if (!response.ok) throw fail('Sumber email gagal merespons.');
  try { data = await response.json(); } catch { throw fail('Respons sumber email tidak valid.'); }
  if (!Array.isArray(data?.messages) || data.messages.length > LIMITS.messages || typeof data.limited !== 'boolean') throw fail('Respons sumber email tidak valid.');
  const seen = new Set(), messages = [];
  for (const m of data.messages) {
    if (typeof m?.id !== 'string' || !m.id || m.id.length > 512 || seen.has(m.id) || m.to !== alias) throw fail('Respons sumber email tidak valid.');
    seen.add(m.id); messages.push(present(m));
  }
  return {messages, limited:data.limited, scanned:data.messages.length, coverage:'Cloudflare'};
}
export async function inbox(address) {
  await requireIdentity();
  const alias = inboxAlias(address);
  requireAgent(await readAgents(await requireSheets()), alias);
  return fetchMessages(alias);
}
