import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { emailPreview } from './email-preview.js';
export const OWNER = 'madepranajaya01@gmail.com';
export const OUTLOOK_MAILBOX = 'ind0n3s1aemas@outlook.com';
export const DEFAULT_SHEET = '1sj0Ax-RvcAYJuKMLQ0DphswKB5hrcylD-uMFeSp2MaI';
export function email(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(v) || v.length > 254) throw new Error('Alamat email tidak valid.');
  return v;
}
export function inboxAlias(value) {
  let v;
  try { v = email(value); } catch { v = ''; }
  if (/^1nd0n3s1aemas(?:\+[a-z0-9._-]+)?@gmail\.com$/.test(v)) throw Object.assign(new Error('Alias Gmail lama tidak lagi dibaca. Tunggu migrasi alias ke @mdprana.site.'), {status:400});
  if (!/^[a-z0-9._-]{1,64}@mdprana\.site$/.test(v)) throw Object.assign(new Error('Inbox hanya tersedia untuk alias @mdprana.site.'), {status:400});
  return v;
}
export function recipients(header) {
  // Split only outside quoted display names and angle brackets. Ignore comments.
  const parts = String(header ?? '').replace(/\([^()]*\)/g, '').match(/(?:"(?:[^"\\]|\\.)*"|<[^>]*>|[^,])+/g) || [];
  return parts.flatMap(part => {
    const angle = part.match(/<([^<>]+)>\s*$/);
    const candidate = angle ? angle[1] : part.trim();
    try { return [email(candidate)]; } catch { return []; }
  });
}
export function hasRecipient(headers, alias) {
  return Array.isArray(headers) && headers.some(h => typeof h?.name === 'string' && typeof h.value === 'string' && ['to', 'cc', 'delivered-to', 'x-original-to'].includes(h.name.toLowerCase()) && recipients(h.value).includes(alias));
}
export function safeLink(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && ['linkumkm.id', 'www.linkumkm.id', 'linkumkm.bri.co.id'].includes(u.hostname) && !u.username && !u.password && (!u.port || u.port === '443') ? u.href : null;
  } catch { return null; }
}
export function column(index) {
  let result = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
export function sheetRange(title, range) { return `'${title.replaceAll("'", "''")}'!${range}`; }
export function parseRows(title, values) {
  if (!values.length) return [];
  const norm = s => String(s ?? '').trim().toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
  const headers = values[0].map(norm);
  const ec = headers.indexOf('email');
  const nc = headers.findIndex(h => ['agent name', 'nama agen', 'nama agent', 'nama', 'agent', 'agen'].includes(h));
  const sc = headers.findIndex(h => ['status', 'status verifikasi', 'verification status'].includes(h));
  const [cc, dc, vc] = ['kota/kab', 'kecamatan', 'desa/kelurahan'].map(h => headers.indexOf(h));
  const cell = (row, c) => c < 0 ? '' : String(row[c] ?? '').trim();
  if (ec < 0 || nc < 0) return [];
  return values.slice(1).flatMap((row, i) => {
    if (!String(row[ec] ?? '').trim()) return [];
    let address; try { address = email(row[ec]); } catch { return []; }
    return [{email: address, name: String(row[nc] || address), status: String(row[sc] || ''), sheet: title, row: i + 2, statusColumn: sc, city: cell(row, cc), district: cell(row, dc), village: cell(row, vc)}];
  });
}
export function uniqueRow(rows, address) {
  const matches = rows.filter(r => r.email === email(address));
  if (matches.length !== 1) throw new Error(matches.length ? 'Email duplikat di spreadsheet. Perbaiki sebelum menyimpan.' : 'Email tidak ditemukan. Muat ulang daftar agen.');
  if (matches[0].statusColumn < 0) throw new Error('Kolom Status tidak ditemukan. Tambahkan header Status.');
  return matches[0];
}
export function seal(payload, secret) {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET minimal 32 karakter.');
  const iv = randomBytes(12), key = createHash('sha256').update(secret).digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
export function unseal(value, secret) {
  try {
    if (!secret || secret.length < 32 || !value || value.length > 16384) return null;
    const data = Buffer.from(value, 'base64url');
    const cipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), data.subarray(0,12));
    cipher.setAuthTag(data.subarray(12,28));
    const result = JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
    return result.exp > Date.now() ? result : null;
  } catch { return null; }
}
export function messageContent(payload) {
  const plain = [], html = [];
  function visit(p) {
    if (p.filename || p.headers?.some(h => h.name.toLowerCase() === 'content-disposition' && /^attachment\b/i.test(h.value))) return;
    if (p.body?.data) {
      const text = Buffer.from(p.body.data, 'base64url').toString('utf8');
      if (p.mimeType === 'text/plain') plain.push(text);
      else if (p.mimeType === 'text/html') html.push(text);
    }
    (p.parts || []).forEach(visit);
  }
  visit(payload);
  return renderContent(plain, html);
}
export function renderContent(plain, html) {
  // Text fallback remains inert; HTML preview is sanitized and isolated with no remote resources.
  const decode = s => s.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, ' ');
  const body = (plain.length ? plain.join('\n') : decode(html.join('\n').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?\s*>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]*>/g, ''))).slice(0, 100000);
  const candidates = [...(body.match(/https:\/\/[^\s<>"']+/g) || []), ...html.flatMap(h => [...h.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(m => decode(m[1])))];
  return {body, html: emailPreview(html.join('\n').slice(0,100000)), links: [...new Set(candidates.map(safeLink).filter(Boolean))]};
}
export function validHint(h) {
  if (typeof h !== 'string') return null;
  const v = h.trim();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}
