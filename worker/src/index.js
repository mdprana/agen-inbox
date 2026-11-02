export const DOMAIN = 'mdprana.site';
export const MAX_RAW = 1024 * 1024;
export const TTL = 30 * 86400;
export const LIMIT = 50;
const BODY = 100000;
const MAX_TS = 9999999999999;

export function validAlias(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return /^[a-z0-9._-]{1,64}@mdprana\.site$/.test(v) ? v : null;
}
export function messageKey(alias, time, id) {
  return `msg:${alias}:${String(MAX_TS - time).padStart(13, '0')}:${id}`;
}
export function authorized(header, token) {
  if (typeof token !== 'string' || token.length < 16 || typeof header !== 'string') return false;
  const enc = new TextEncoder(), a = enc.encode(header), b = enc.encode(`Bearer ${token}`);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}
export function record(parsed, to, id, now = Date.now()) {
  const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  const date = new Date(parsed?.date);
  return {id, to, from:{name:str(parsed?.from?.name, 256), address:str(parsed?.from?.address, 256)}, subject:str(parsed?.subject, 998), date:(Number.isNaN(date.getTime()) ? new Date(now) : date).toISOString(), html:str(parsed?.html, BODY), text:str(parsed?.text, BODY)};
}
const postalParse = async raw => (await import('postal-mime')).default.parse(raw);

export async function handleEmail(message, env, parse = postalParse) {
  const to = String(message.to ?? '').trim().toLowerCase();
  if (!to.endsWith('@' + DOMAIN)) return message.setReject('Unknown recipient');
  if (!(message.rawSize <= MAX_RAW)) return message.setReject('Message too large');
  const alias = validAlias(to);
  let stored = false, forwarded = false;
  if (alias) {
    try {
      const raw = await new Response(message.raw).arrayBuffer(), id = crypto.randomUUID(), now = Date.now();
      if (raw.byteLength > MAX_RAW) return message.setReject('Message too large');
      await env.MAIL.put(messageKey(alias, now, id), JSON.stringify(record(await parse(raw), alias, id, now)), {expirationTtl:TTL});
      stored = true;
    } catch { console.error('store failed'); }
  }
  if (env.FORWARD_TO) {
    try { await message.forward(env.FORWARD_TO); forwarded = true; } catch { console.error('forward failed'); }
  }
  if (!stored && !forwarded) message.setReject('Temporary storage failure; please retry');
}

const json = (body, status = 200) => Response.json(body, {status, headers:{'Cache-Control':'no-store'}});
export async function handleFetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/messages') return json({error:'Not found'}, 404);
  if (request.method !== 'GET') return json({error:'Method not allowed'}, 405);
  if (!authorized(request.headers.get('Authorization'), env.READ_TOKEN)) return json({error:'Unauthorized'}, 401);
  const alias = validAlias(url.searchParams.get('alias'));
  if (!alias || alias !== url.searchParams.get('alias')) return json({error:'Invalid alias'}, 400);
  try {
    const list = await env.MAIL.list({prefix:`msg:${alias}:`, limit:LIMIT});
    const values = await Promise.all(list.keys.map(k => env.MAIL.get(k.name, {type:'json'})));
    return json({messages:values.filter(v => v && v.to === alias), limited:!list.list_complete});
  } catch {
    console.error('read failed');
    return json({error:'Storage unavailable'}, 503);
  }
}

export default {
  email: (message, env, ctx) => handleEmail(message, env),
  fetch: (request, env) => handleFetch(request, env)
};
