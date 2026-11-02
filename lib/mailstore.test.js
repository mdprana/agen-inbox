import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { OWNER } from './helpers.js';
import { sessionStore, connectionStore, ownerConnection, DATA_SCOPES } from './team-auth.js';
const jarData = new Map();
globalThis.__j5Cookies = {get:name => jarData.has(name) ? {value:jarData.get(name)} : undefined, set:(name,value) => jarData.set(name,value), delete:name => jarData.delete(name)};
registerHooks({resolve(specifier, context, next) {
  if (specifier === 'next/headers') return {url:'data:text/javascript,export async function cookies(){return globalThis.__j5Cookies}', shortCircuit:true};
  return next(specifier, context);
}});
const { mailConfig, fetchMessages, requireAgent, LIMITS } = await import('./mailstore.js');
const WORKER = 'https://mail.example.invalid', TOKEN = 'w'.repeat(32);
const mailEnv = {MAIL_WORKER_URL:WORKER, MAIL_WORKER_TOKEN:TOKEN};
const TEAM = ['member@example.test'];
const env = {TEAM_EMAILS:[OWNER,...TEAM].join(','), SESSION_SECRET:'s'.repeat(32), APP_URL:'http://localhost:3109', GOOGLE_CLIENT_ID:'test-client', GOOGLE_CLIENT_SECRET:'test-secret', UPSTASH_REDIS_REST_URL:'https://redis.example', UPSTASH_REDIS_REST_TOKEN:'test-only', ...mailEnv};
const alias = 'agent@mdprana.site';
const stored = (id, extra = {}) => ({id, to:alias, from:{name:'Sender', address:'sender@example.invalid'}, subject:'S '+id, date:'2026-01-01T00:00:00.000Z', html:'', text:'Body '+id, ...extra});

test('mailConfig requires https origin without creds/query/path and a token', () => {
  assert.deepEqual(mailConfig(mailEnv), []);
  assert.deepEqual(mailConfig({}), ['MAIL_WORKER_URL', 'MAIL_WORKER_TOKEN']);
  for (const u of ['http://mail.example.invalid', 'https://u:p@mail.example.invalid', 'https://mail.example.invalid/', 'https://mail.example.invalid/x', 'https://mail.example.invalid?a=1', 'https://mail.example.invalid#x', 'nope']) assert.deepEqual(mailConfig({...mailEnv, MAIL_WORKER_URL:u}), ['MAIL_WORKER_URL'], u);
});
test('Sheet alias gate requires exactly one row', () => {
  requireAgent([{email:alias}, {email:'other@mdprana.site'}], alias);
  assert.throws(() => requireAgent([], alias), e => e.status === 404);
  assert.throws(() => requireAgent([{email:alias},{email:alias}], alias), e => e.status === 409);
});
test('fetchMessages: bearer GET no-store, strict shape, limits, inert presentation, mapped errors', async () => {
  const html = '<script>alert(1)</script><img src="https://evil.invalid/p.png"><a href="https://linkumkm.id/activate?token=abc&amp;u=1">Aktivasi</a><a href="https://evil.invalid">x</a>';
  const calls = [];
  const fetcher = async (url, options) => { calls.push({url, options}); return Response.json({messages:[stored('h', {html}), stored('t'), stored('bad', {subject:42, from:null, date:'nope', text:'x'.repeat(LIMITS.body+10)})], limited:false}); };
  const result = await fetchMessages(alias, {fetcher, env:mailEnv});
  assert.equal(calls[0].url, `${WORKER}/messages?alias=agent%40mdprana.site`);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${TOKEN}`); assert.equal(calls[0].options.cache, 'no-store'); assert.equal(calls[0].options.method, 'GET'); assert.ok(calls[0].options.signal);
  assert.equal(result.coverage, 'Cloudflare'); assert.equal(result.limited, false); assert.equal(result.scanned, 3);
  assert.deepEqual(result.messages.map(m => m.id), ['h', 't', 'bad']);
  const [h, t, bad] = result.messages;
  assert.deepEqual(Object.keys(h).sort(), ['body','date','from','html','id','links','subject']);
  assert.deepEqual(h.links, ['https://linkumkm.id/activate?token=abc&u=1']);
  assert.doesNotMatch(h.html, /<(?:script|img)\b|\bsrc=/);
  assert.equal(t.body, 'Body t'); assert.equal(t.from, 'Sender <sender@example.invalid>');
  assert.equal(bad.subject, '(Tanpa subjek)'); assert.equal(bad.from, ''); assert.equal(bad.date, ''); assert.equal(bad.body.length, LIMITS.body);
  await assert.rejects(() => fetchMessages(alias, {fetcher:async () => assert.fail('no fetch'), env:{}}), e => e.status === 503);
  for (const body of [{}, {messages:'x', limited:false}, {messages:[]}, {messages:Array(51).fill(stored('a')), limited:false}, ...[[null], [{id:''}], [stored('foreign', {to:'other@mdprana.site'})], [stored('a'), stored('a')]].map(messages => ({messages, limited:false})), null]) await assert.rejects(() => fetchMessages(alias, {fetcher:async () => Response.json(body), env:mailEnv}), e => e.status === 502 && /tidak valid/.test(e.message));
  await assert.rejects(() => fetchMessages(alias, {fetcher:async () => new Response('not json'), env:mailEnv}), e => e.status === 502);
  await assert.rejects(() => fetchMessages(alias, {fetcher:async () => new Response('', {status:401}), env:mailEnv}), e => e.status === 503 && /token/.test(e.message));
  await assert.rejects(() => fetchMessages(alias, {fetcher:async () => new Response('secret detail', {status:500}), env:mailEnv}), e => e.status === 502 && !/secret/.test(e.message));
  await assert.rejects(() => fetchMessages(alias, {fetcher:async () => { throw new DOMException('timeout', 'TimeoutError'); }, env:mailEnv}), e => e.status === 503);
});

function redisFixture() {
  const data = new Map();
  const fetcher = async (url, options) => {
    const a = JSON.parse(options.body);
    let result = null;
    if (a[0] === 'GET') result = data.get(a[1]) ?? null;
    else if (a[0] === 'SET') { if (!(a.includes('NX') && data.has(a[1]))) { data.set(a[1], a[2]); result = 'OK'; } }
    else if (a[0] === 'DEL') result = Number(data.delete(a[1]));
    else if (a[0] === 'EVAL') {
      if (a[1].includes('KEYS[2]')) { if (data.get(a[4]) === a[5]) { data.set(a[3], a[6]); result = 1; } else result = 0; }
      else if (a[1].includes('authVersion')) { const u = JSON.parse(data.get(a[3]) || 'null'); if (u) { u.authVersion++; data.set(a[3], JSON.stringify(u)); result = 1; } else result = 0; }
      else if (data.get(a[3]) === a[4]) { data.delete(a[3]); result = 1; } else result = 0;
    } else assert.fail('unexpected redis '+a[0]);
    return Response.json({result});
  };
  return {data, fetcher};
}
test('route: auth first, alias validation, unique Sheet row, then Worker; session readiness', async () => {
  const previous = {...process.env}, previousFetch = globalThis.fetch, r = redisFixture(), network = [];
  const sheetRows = [['Email','Nama','Status'],[alias,'Demo',''],['dup@mdprana.site','A',''],['dup@mdprana.site','B','']];
  for (const k of ['KV_REST_API_URL','KV_REST_API_TOKEN','TEAM_EMAILS']) delete process.env[k];
  Object.assign(process.env, env);
  globalThis.fetch = async (url, options = {}) => {
    url = String(url); network.push(url);
    if (url === env.UPSTASH_REDIS_REST_URL) return r.fetcher(url, options);
    if (url.startsWith('https://sheets.googleapis.com/')) return Response.json(url.includes('batchGet') ? {valueRanges:[{values:sheetRows}]} : {sheets:[{properties:{title:'Synthetic'}}]});
    if (url.startsWith(WORKER+'/')) return Response.json({messages:[stored('in')], limited:false});
    assert.fail('Unexpected external request '+url);
  };
  try {
    const sessions = sessionStore(), inbox = await import('../app/api/inbox/route.js'), sessionRoute = await import('../app/api/session/route.js');
    const get = e => inbox.GET(new Request(env.APP_URL+'/api/inbox?email='+encodeURIComponent(e)));
    const workerCalls = () => network.filter(u => u.startsWith(WORKER)).length;
    jarData.clear();
    assert.equal((await get(alias)).status, 401);
    assert.equal((await get('bad')).status, 401);
    const memberId = await sessions.create({email:TEAM[0], sub:'member-sub', email_verified:true});
    await sessions.create({email:OWNER, sub:'owner-sub', email_verified:true});
    jarData.set('agen_session_v2', memberId);
    const ready = await (await sessionRoute.GET()).json();
    assert.equal(ready.mailReady, true); assert.equal(ready.sheetsReady, false); assert.equal(ready.mail.coverage, 'Cloudflare');
    assert.equal(JSON.stringify(ready).includes(TOKEN), false);
    assert.equal((await get(alias)).status, 503);
    await connectionStore().write(ownerConnection({access_token:'g', refresh_token:'g', expires_in:3600, scope:DATA_SCOPES.join(' ')}, {email:OWNER, userId:OWNER, sub:'owner-sub'}));
    for (const [address, status] of [['absent@mdprana.site', 404], ['dup@mdprana.site', 409], ['1nd0n3s1aemas+agent@gmail.com', 400], ['agent@mdprana.site OR all', 400], ['agent@evil.com', 400]]) {
      const res = await get(address); assert.equal(res.status, status, address); assert.ok((await res.json()).error);
    }
    assert.equal(workerCalls(), 0);
    const migration = await import('../app/api/migration/route.js');
    const migrate = (body, origin=env.APP_URL, type='application/json') => migration.POST(new Request(env.APP_URL+'/api/migration',{method:'POST',headers:{origin,'content-type':type},body}));
    assert.equal((await migrate('{"action":"plan"}')).status,403);
    jarData.delete('agen_session_v2');
    assert.equal((await migrate('{"action":"plan"}')).status,401);
    const ownerId=await sessions.create({email:OWNER,sub:'owner-sub',email_verified:true});
    jarData.set('agen_session_v2',ownerId);
    const sheetsBefore=network.filter(u=>u.startsWith('https://sheets.googleapis.com/')).length;
    for(const action of ['apply','backup','confirm-backup','report']) assert.equal((await migrate(JSON.stringify({action}))).status,409);
    for(const body of ['{"action":"other"}','{"action":"plan","workbook":"client"}','[]','{','x'.repeat(257)]) assert.equal((await migrate(body)).status,400);
    for(const origin of ['', 'https://foreign.invalid']) assert.equal((await migrate('{"action":"plan"}',origin)).status,403);
    assert.equal((await migrate('{"action":"plan"}',env.APP_URL,'text/plain')).status,415);
    assert.equal(network.filter(u=>u.startsWith('https://sheets.googleapis.com/')).length,sheetsBefore);
    const originalFetch=globalThis.fetch;
    globalThis.fetch=async(url,options={})=>{
      if(String(url).includes('?includeGridData=true')) {
        assert.equal(options.method,'GET');
        return Response.json({spreadsheetId:'synthetic',properties:{title:'Synthetic'},sheets:[{properties:{sheetId:1,title:'Synthetic',sheetType:'GRID',gridProperties:{rowCount:10,columnCount:3}},data:[{rowData:[{values:[{userEnteredValue:{stringValue:'Email'}},{userEnteredValue:{stringValue:'Status'}}]}]}]}]});
      }
      return originalFetch(url,options);
    };
    const backup=await migrate('{"action":"plan"}'); assert.equal(backup.status,200); assert.equal(backup.headers.get('cache-control'),'no-store'); assert.ok(backup.headers.get('X-Backup-SHA256')); assert.match(backup.headers.get('content-disposition'),/attachment/);
    globalThis.fetch=originalFetch;
    await sessions.revokeAll(OWNER);
    assert.equal((await migrate('{"action":"plan"}')).status,401);
    jarData.set('agen_session_v2',memberId);
    const ok = await get(alias); assert.equal(ok.status, 200); assert.equal(ok.headers.get('cache-control'), 'no-store');
    const data = await ok.json();
    assert.deepEqual(data.messages.map(m => m.id), ['in']); assert.equal(data.limited, false); assert.equal(data.coverage, 'Cloudflare'); assert.equal(data.scanned, 1);
    assert.equal(JSON.stringify(data).includes(TOKEN), false);
    delete process.env.MAIL_WORKER_TOKEN;
    assert.equal((await (await sessionRoute.GET()).json()).mailReady, false);
    assert.equal((await get(alias)).status, 503);
    await sessions.revokeAll(TEAM[0]);
    assert.equal((await get(alias)).status, 401);
    assert.equal(workerCalls(), 1);
  } finally {
    globalThis.fetch = previousFetch; jarData.clear();
    for (const k of Object.keys(process.env)) if (!(k in previous)) delete process.env[k];
    Object.assign(process.env, previous);
  }
});
