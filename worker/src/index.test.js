import test from 'node:test';
import assert from 'node:assert/strict';
import { validAlias, messageKey, authorized, handleEmail, handleFetch, MAX_RAW, TTL } from './index.js';

function kv() {
  const data = new Map(), puts = [];
  return {data, puts,
    async put(key, value, opts) { puts.push({key, opts}); data.set(key, value); },
    async get(key) { return data.has(key) ? JSON.parse(data.get(key)) : null; },
    async list({prefix, limit}) { const keys = [...data.keys()].filter(k => k.startsWith(prefix)).sort(); return {keys:keys.slice(0, limit).map(name => ({name})), list_complete:keys.length <= limit}; }
  };
}
const mail = (to, extra = {}) => {
  const m = {to, raw:'raw-mime', rawSize:100, rejected:null, forwarded:[], setReject(r) { m.rejected = r; }, async forward(a) { m.forwarded.push(a); }, ...extra};
  return m;
};
const parse = async () => ({subject:'Hi', from:{name:'Sender', address:'s@example.invalid'}, date:'2026-01-01T00:00:00Z', html:'<p>x</p>', text:'x'});
const TOKEN = 't'.repeat(32);

test('alias validator, key order newest first, constant-time auth', () => {
  assert.equal(validAlias(' Agent@MDPRANA.site '), 'agent@mdprana.site');
  for (const bad of ['a+b@mdprana.site', 'a@sub.mdprana.site', 'a@mdprana.site.evil.com', '@mdprana.site', null, `${'a'.repeat(65)}@mdprana.site`]) assert.equal(validAlias(bad), null);
  assert.ok(messageKey('a@mdprana.site', 2000, 'x') < messageKey('a@mdprana.site', 1000, 'y'));
  assert.match(messageKey('a@mdprana.site', Date.now(), 'id'), /^msg:a@mdprana\.site:\d{13}:id$/);
  assert.equal(authorized(`Bearer ${TOKEN}`, TOKEN), true);
  for (const h of [null, '', TOKEN, `Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(1)}`, `bearer ${TOKEN}`]) assert.equal(authorized(h, TOKEN), false);
  assert.equal(authorized('Bearer short', 'short'), false);
  assert.equal(authorized('Bearer undefined', undefined), false);
});

test('email: rejects foreign domain and oversize, stores with TTL, forwards even if storage fails', async () => {
  const env = {MAIL:kv(), FORWARD_TO:'backup@outlook.invalid'};
  const foreign = mail('x@evil.com'); await handleEmail(foreign, env, parse);
  assert.ok(foreign.rejected); assert.equal(env.MAIL.puts.length, 0);
  const big = mail('a@mdprana.site', {rawSize:MAX_RAW + 1}); await handleEmail(big, env, parse);
  assert.ok(big.rejected); assert.equal(env.MAIL.puts.length, 0); assert.deepEqual(big.forwarded, []);
  const actualBig = mail('a@mdprana.site', {raw:'x'.repeat(MAX_RAW + 1)}); await handleEmail(actualBig, env, parse);
  assert.equal(actualBig.rejected, 'Message too large'); assert.equal(env.MAIL.puts.length, 0); assert.deepEqual(actualBig.forwarded, []);
  const ok = mail('Agent@mdprana.site'); await handleEmail(ok, env, parse);
  assert.equal(ok.rejected, null); assert.deepEqual(ok.forwarded, ['backup@outlook.invalid']);
  const [put] = env.MAIL.puts;
  assert.match(put.key, /^msg:agent@mdprana\.site:\d{13}:/); assert.equal(put.opts.expirationTtl, TTL);
  const stored = JSON.parse(env.MAIL.data.get(put.key));
  assert.deepEqual(Object.keys(stored).sort(), ['date','from','html','id','subject','text','to']);
  assert.equal(stored.to, 'agent@mdprana.site'); assert.equal(stored.from.address, 's@example.invalid');
  const broken = {MAIL:{put:async () => { throw new Error('kv down'); }}, FORWARD_TO:'backup@outlook.invalid'};
  const m2 = mail('agent@mdprana.site'); await handleEmail(m2, broken, parse);
  assert.deepEqual(m2.forwarded, ['backup@outlook.invalid']); assert.equal(m2.rejected, null);
  const m3 = mail('agent@mdprana.site'); await handleEmail(m3, {MAIL:kv(), FORWARD_TO:'b@x.invalid'}, async () => { throw new Error('bad mime'); });
  assert.deepEqual(m3.forwarded, ['b@x.invalid']); assert.equal(m3.rejected, null);
  const m4 = mail('agent@mdprana.site', {forward:async () => { throw new Error('fwd'); }}); const e4 = {MAIL:kv(), FORWARD_TO:'b@x.invalid'};
  await handleEmail(m4, e4, parse); assert.equal(e4.MAIL.puts.length, 1); assert.equal(m4.rejected, null);
  const m5 = mail('agent@mdprana.site'); await handleEmail(m5, {MAIL:kv()}, parse); assert.deepEqual(m5.forwarded, []); assert.equal(m5.rejected, null);
});

test('email: rejects when neither storage nor forwarding succeeds, including invalid local parts', async () => {
  for (const to of ['agent@mdprana.site', 'a+b@mdprana.site', '@mdprana.site']) {
    for (const FORWARD_TO of [undefined, 'backup@outlook.invalid']) {
      let attempts = 0;
      const m = mail(to, {forward:async () => { attempts++; throw new Error('forward down'); }});
      await handleEmail(m, {MAIL:{put:async () => { throw new Error('kv down'); }}, FORWARD_TO}, parse);
      assert.equal(m.rejected, 'Temporary storage failure; please retry');
      assert.equal(attempts, FORWARD_TO ? 1 : 0);
    }
  }
  const invalid = mail('a+b@mdprana.site');
  await handleEmail(invalid, {MAIL:kv(), FORWARD_TO:'backup@outlook.invalid'}, parse);
  assert.equal(invalid.rejected, null); assert.deepEqual(invalid.forwarded, ['backup@outlook.invalid']);
  const malformed = mail('agent@mdprana.site');
  await handleEmail(malformed, {MAIL:kv()}, async () => { throw new Error('bad mime'); });
  assert.equal(malformed.rejected, 'Temporary storage failure; please retry');
});

test('email: real postal-mime parses multipart plain text and HTML into stored fields', async () => {
  const raw = [
    'From: Fixture Sender <sender@example.invalid>',
    'To: Agent <agent@mdprana.site>',
    'Subject: MIME fixture',
    'Date: Thu, 01 Jan 2026 00:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="fixture-boundary"',
    '',
    '--fixture-boundary',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Plain fixture body',
    '--fixture-boundary',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>HTML fixture body</p>',
    '--fixture-boundary--',
    ''
  ].join('\r\n');
  const env = {MAIL:kv(), FORWARD_TO:'backup@outlook.invalid'};
  const m = mail('Agent@MDPRANA.site', {raw, rawSize:new TextEncoder().encode(raw).byteLength});
  await handleEmail(m, env);
  assert.equal(m.rejected, null); assert.deepEqual(m.forwarded, ['backup@outlook.invalid']);
  assert.equal(env.MAIL.puts.length, 1);
  const stored = JSON.parse(env.MAIL.data.get(env.MAIL.puts[0].key));
  assert.equal(stored.to, 'agent@mdprana.site');
  assert.deepEqual(stored.from, {name:'Fixture Sender', address:'sender@example.invalid'});
  assert.equal(stored.subject, 'MIME fixture');
  assert.equal(stored.date, '2026-01-01T00:00:00.000Z');
  assert.equal(stored.text.trim(), 'Plain fixture body');
  assert.equal(stored.html.trim(), '<p>HTML fixture body</p>');
  assert.match(stored.id, /^[0-9a-f-]{36}$/);
});

test('fetch: path/method/auth/alias gates, newest 50, no-store', async () => {
  const env = {MAIL:kv(), READ_TOKEN:TOKEN};
  for (let i = 0; i < 55; i++) await handleEmail(mail('agent@mdprana.site'), env, parse);
  await handleEmail(mail('other@mdprana.site'), env, parse);
  const req = (path, opts = {}) => handleFetch(new Request('https://w.invalid' + path, {headers:{Authorization:`Bearer ${TOKEN}`}, ...opts}), env);
  assert.equal((await req('/other')).status, 404);
  assert.equal((await req('/messages?alias=agent@mdprana.site', {method:'POST'})).status, 405);
  assert.equal((await req('/messages?alias=agent@mdprana.site', {headers:{}})).status, 401);
  assert.equal((await req('/messages?alias=agent@mdprana.site', {headers:{Authorization:'Bearer wrong'}})).status, 401);
  assert.equal((await handleFetch(new Request('https://w.invalid/messages?alias=agent@mdprana.site', {headers:{Authorization:'Bearer undefined'}}), {MAIL:env.MAIL})).status, 401);
  for (const a of ['agent@evil.com', 'a+b@mdprana.site', 'AGENT@mdprana.site', '']) assert.equal((await req('/messages?alias=' + encodeURIComponent(a))).status, 400, a);
  const res = await req('/messages?alias=agent@mdprana.site');
  assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.messages.length, 50); assert.equal(body.limited, true);
  assert.ok(body.messages.every(m => m.to === 'agent@mdprana.site'));
  const one = await (await req('/messages?alias=other@mdprana.site')).json();
  assert.equal(one.messages.length, 1); assert.equal(one.limited, false);
  const expected = [...env.MAIL.data.keys()].filter(k => k.startsWith('msg:agent@mdprana.site:')).sort().slice(0, 50).map(k => JSON.parse(env.MAIL.data.get(k)).id);
  assert.deepEqual(body.messages.map(m => m.id), expected);
  const failed = await handleFetch(new Request('https://w.invalid/messages?alias=agent@mdprana.site', {headers:{Authorization:`Bearer ${TOKEN}`}}), {READ_TOKEN:TOKEN, MAIL:{list:async () => { throw new Error('private'); }}});
  assert.equal(failed.status, 503); assert.equal(failed.headers.get('cache-control'), 'no-store');
});
