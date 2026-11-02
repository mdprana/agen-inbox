import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { OWNER, OUTLOOK_MAILBOX, seal, unseal } from './helpers.js';
import { TEAM, sessionStore, connectionStore, ownerConnection, outlookConnection, DATA_SCOPES } from './team-auth.js';
const jarData = new Map();
globalThis.__j2Cookies = {get:name => jarData.has(name) ? {value:jarData.get(name)} : undefined, set:(name,value) => jarData.set(name,value), delete:name => jarData.delete(name)};
registerHooks({resolve(specifier, context, next) {
  if (specifier === 'next/headers') return {url:'data:text/javascript,export async function cookies(){return globalThis.__j2Cookies}', shortCircuit:true};
  return next(specifier, context);
}});
const { graphUrl, graphGet, verifyMailbox, recipientMatch, requireAgent, scanMailbox, validateOutlookState, LIMITS, STATE_COOKIE } = await import('./outlook.js');
const env = {SESSION_SECRET:'s'.repeat(32), APP_URL:'http://localhost:3109', GOOGLE_CLIENT_ID:'test-client', GOOGLE_CLIENT_SECRET:'test-secret', MICROSOFT_CLIENT_ID:'ms-client', MICROSOFT_CLIENT_SECRET:'ms-secret', UPSTASH_REDIS_REST_URL:'https://redis.example', UPSTASH_REDIS_REST_TOKEN:'test-only'};
const alias = 'agent@mdprana.site';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const msg = (id, extra = {}) => ({id, subject:'S '+id, from:{emailAddress:{name:'Sender', address:'sender@example.invalid'}}, receivedDateTime:'2026-01-01T00:00:00Z', toRecipients:[{emailAddress:{address:OUTLOOK_MAILBOX}}], ccRecipients:[], internetMessageHeaders:[], ...extra});
const to = address => ({toRecipients:[{emailAddress:{name:'x', address}}]});
const header = (name, value) => ({internetMessageHeaders:[{name, value}]});

test('Graph nextLink/URL allowlist never forwards bearer elsewhere', () => {
  assert.equal(graphUrl(`${GRAPH}/me/mailFolders/inbox/messages?$skip=100`), `${GRAPH}/me/mailFolders/inbox/messages?$skip=100`);
  for (const bad of ['http://graph.microsoft.com/v1.0/me/messages','https://graph.microsoft.com.evil.com/v1.0/me/x','https://evil.com/v1.0/me/x','https://user@graph.microsoft.com/v1.0/me/x','https://graph.microsoft.com:8443/v1.0/me/x','https://graph.microsoft.com/beta/me/x','https://graph.microsoft.com/v1.0/users/x/messages','https://graph.microsoft.com/v1.0/me/../users/x','https://graph.microsoft.com/v1.0/me/%2e%2e/users','https://graph.microsoft.com/v1.0/meeting','https://graph.microsoft.com/v1.0/me/x#frag','//graph.microsoft.com/v1.0/me/','javascript:alert(1)',42]) assert.throws(() => graphUrl(bad), /tidak valid/, String(bad));
});
test('Microsoft profile must be exact expected mailbox with stable id', () => {
  assert.equal(verifyMailbox({id:'mbx', mail:OUTLOOK_MAILBOX, userPrincipalName:'IND0N3S1AEMAS@outlook.com'}), 'mbx');
  for (const bad of [{id:'mbx', mail:'1nd0n3s1aemas@outlook.com', userPrincipalName:OUTLOOK_MAILBOX},{id:'mbx', mail:null, userPrincipalName:OUTLOOK_MAILBOX},{id:'mbx', userPrincipalName:OUTLOOK_MAILBOX},{id:'mbx', mail:OUTLOOK_MAILBOX, userPrincipalName:'other@outlook.com'},{id:'', mail:OUTLOOK_MAILBOX, userPrincipalName:OUTLOOK_MAILBOX},{mail:OUTLOOK_MAILBOX, userPrincipalName:OUTLOOK_MAILBOX},{id:'mbx', mail:OWNER, userPrincipalName:OWNER},null]) assert.throws(() => verifyMailbox(bad));
});
test('exact original recipient proof only: To/Cc fields or To/Cc/Delivered-To/X-Original-To headers', () => {
  for (const m of [to(alias), to(' AGENT@mdprana.site '), {ccRecipients:[{emailAddress:{address:alias}}]}, header('To', `"Agen" <${alias}>`), header('cc', `a@example.invalid, ${alias}`), header('Delivered-To', alias), header('X-Original-To', alias.toUpperCase())]) assert.equal(recipientMatch(m, alias), true, JSON.stringify(m));
  for (const m of [to(OUTLOOK_MAILBOX), to('agent2@mdprana.site'), to('agen@mdprana.site'), to('xagent@mdprana.site'), to('agent@mdprana.site.evil.com'), to('agent@mdprana-site.com'), to('agent@sub.mdprana.site'), to('agent+x@mdprana.site'), {toRecipients:[{emailAddress:{name:alias, address:'evil@example.invalid'}}]}, header('To', `"${alias}" <evil@example.invalid>`), header('Subject', alias), header('From', alias), header('Return-Path', alias), header('Received', `for <${alias}>`), header('Reply-To', alias), header('X-Forwarded-To', alias), header('To', `evil@example.invalid\r\nTo: ${alias}`), header('To', `${alias}x`), {subject:alias, bodyPreview:alias, from:{emailAddress:{address:alias}}}, {}, {toRecipients:'agent@mdprana.site', internetMessageHeaders:'To: agent@mdprana.site'}, {toRecipients:[null,{emailAddress:null},{emailAddress:{address:42}}], internetMessageHeaders:[null,{name:'To'},{name:'To', value:['x']}]}, null]) assert.equal(recipientMatch(m, alias), false, JSON.stringify(m));
});
test('Sheet alias gate requires exactly one row', () => {
  requireAgent([{email:alias}, {email:'other@mdprana.site'}], alias);
  assert.throws(() => requireAgent([], alias), /tidak terdaftar/);
  assert.throws(() => requireAgent([{email:alias},{email:alias}], alias), /duplikat/);
});

function graph(pages, {bodies = {}, extra} = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({url:String(url), method:options.method, auth:options.headers.Authorization});
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    const u = new URL(url);
    assert.equal(u.origin, 'https://graph.microsoft.com');
    if (extra) { const r = await extra(u, calls); if (r) return r; }
    const body = u.pathname.match(/^\/v1\.0\/me\/messages\/([^/]+)$/);
    if (body) { const id = decodeURIComponent(body[1]); assert.equal(u.searchParams.get('$select'), 'id,body'); return Response.json(bodies[id] ?? {id, body:{contentType:'text', content:'Body '+id}}); }
    const folder = u.pathname.match(/^\/v1\.0\/me\/mailFolders\/(inbox|junkemail)\/messages$/)?.[1];
    assert.ok(folder, url);
    if (!u.searchParams.has('page')) {
      assert.equal(u.searchParams.get('$top'), '100'); assert.equal(u.searchParams.get('$orderby'), 'receivedDateTime desc');
      assert.equal(u.searchParams.get('$select'), 'id,subject,from,receivedDateTime,toRecipients,ccRecipients,internetMessageHeaders');
      assert.equal(u.searchParams.has('$search') || u.searchParams.has('$filter'), false);
    }
    const list = pages[folder] || [[]], n = Number(u.searchParams.get('page') || 0);
    return Response.json({value:list[n] || [], ...(n+1 < list.length ? {'@odata.nextLink':`${GRAPH}/me/mailFolders/${folder}/messages?page=${n+1}`} : {})});
  };
  return {calls, fetcher};
}
test('Inbox + Junk scan: positives, dedupe, filtering, inert presentation, GET-only body fetch after authorization', async () => {
  const html = '<script>alert(1)</script><meta http-equiv="refresh" content="0;url=https://evil.invalid"><form action="https://evil.invalid"><input></form><img src="https://evil.invalid/p.png"><img src="cid:logo"><div style="background:url(https://evil.invalid/x)" onclick="alert(1)">Hi</div><a href="https://linkumkm.id/activate?token=abc&amp;u=1">Aktivasi</a><a href="https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Flinkumkm.id">Wrapped</a><a href="https://user:pw@linkumkm.id/x">Cred</a><a href="http://linkumkm.id/x">Http</a><a href="https://linkumkm.id.evil.com/x">Look</a>';
  const g = graph({inbox:[[msg('a', to(alias)), msg('noise'), msg('agg', to(OUTLOOK_MAILBOX))]], junkemail:[[msg('j', {...header('X-Original-To', alias), receivedDateTime:'2026-02-01T00:00:00Z'}), msg('a', to(alias)), msg('bad-date', {...to(alias), receivedDateTime:'not-a-date', subject:42, from:null})]]}, {bodies:{
    j:{id:'j', body:{contentType:'html', content:html}},
    'bad-date':{id:'bad-date', body:{contentType:'text', content:'x'.repeat(LIMITS.body+5000)}},
    a:{id:'other', body:'not-an-object'}
  }});
  const result = await scanMailbox('ms-access', alias, g.fetcher);
  assert.deepEqual(result.messages.map(m => m.id), ['j','a','bad-date']);
  assert.equal(result.limited, false); assert.equal(result.coverage, 'Inbox + Junk');
  const [j, a, bad] = result.messages;
  assert.deepEqual(Object.keys(j).sort(), ['body','date','from','html','id','links','subject']);
  assert.deepEqual(j.links, ['https://linkumkm.id/activate?token=abc&u=1']);
  assert.doesNotMatch(j.html, /<(?:script|form|input|img|iframe|base)\b|http-equiv="refresh"|\b(?:href|src|onclick|action)=|cid:/);
  // ponytail: CSS url() in style attr survives sanitizer; blocked by preview CSP default-src/img-src 'none' (browser gate pending).
  assert.match(j.html, /default-src 'none'.*img-src 'none'/);
  assert.ok(j.html.indexOf('Content-Security-Policy') < j.html.indexOf('Hi'));
  assert.equal(a.body, ''); assert.equal(a.from, 'Sender <sender@example.invalid>');
  assert.equal(bad.date, ''); assert.equal(bad.subject, '(Tanpa subjek)'); assert.equal(bad.from, ''); assert.equal(bad.body.length, LIMITS.body);
  assert.ok(g.calls.every(c => c.method === 'GET' && c.auth === 'Bearer ms-access' && c.url.startsWith(GRAPH+'/me/')));
  const bodyCalls = g.calls.filter(c => c.url.includes('/me/messages/')).map(c => decodeURIComponent(new URL(c.url).pathname.split('/').pop()));
  assert.deepEqual(bodyCalls.sort(), ['a','bad-date','j']);
  assert.equal(g.calls.some(c => /linkumkm|evil|safelinks/.test(c.url)), false);
});
test('budgets: five pages per folder, 50 messages, partial zero result is limited, bounded parallel bodies', async () => {
  const page = (folder, n, match) => Array.from({length:100}, (_, i) => msg(`${folder}-${n}-${i}`, match ? to(alias) : {}));
  const many = graph({inbox:Array.from({length:7}, (_, n) => page('i', n, false)), junkemail:Array.from({length:7}, (_, n) => page('j', n, false))});
  const zero = await scanMailbox('t', alias, many.fetcher);
  assert.equal(zero.messages.length, 0); assert.equal(zero.limited, true); assert.equal(zero.scanned, 1000);
  assert.equal(many.calls.filter(c => c.url.includes('/inbox/')).length, 5); assert.equal(many.calls.filter(c => c.url.includes('/junkemail/')).length, 5);
  let active = 0, peak = 0;
  const lots = graph({inbox:[page('m', 0, true)]}, {extra:async u => { if (u.pathname.startsWith('/v1.0/me/messages/')) { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 2)); active--; } }});
  const capped = await scanMailbox('t', alias, lots.fetcher);
  assert.equal(capped.messages.length, LIMITS.messages); assert.equal(capped.limited, true); assert.ok(peak <= LIMITS.parallel && peak > 1);
  const done = await scanMailbox('t', alias, graph({inbox:[[msg('x', to(alias))]]}).fetcher);
  assert.equal(done.limited, false);
});
test('malicious nextLink, invalid shapes, 429 and timeouts fail bounded without leaking bearer', async () => {
  for (const next of ['https://evil.invalid/v1.0/me/messages','https://graph.microsoft.com/v1.0/users/victim/messages','http://graph.microsoft.com/v1.0/me/messages','https://graph.microsoft.com@evil.invalid/v1.0/me/',{}]) {
    const calls = [];
    const fetcher = async url => { calls.push(String(url)); return Response.json({value:[msg('a', to(alias))], '@odata.nextLink':next}); };
    await assert.rejects(() => scanMailbox('secret-bearer', alias, fetcher), /tidak valid/);
    assert.deepEqual(calls.map(u => new URL(u).hostname), ['graph.microsoft.com']);
  }
  for (const body of [{value:'x'}, {}, {value:Array(101).fill(msg('a'))}, null]) await assert.rejects(() => scanMailbox('t', alias, async () => Response.json(body)), /tidak valid/);
  await assert.rejects(() => scanMailbox('t', alias, async () => new Response('not json', {status:200})), /tidak valid/);
  let n = 0;
  const retry = await scanMailbox('t', alias, async (url, o) => (n++ === 0 ? new Response('', {status:429, headers:{'Retry-After':'0'}}) : graph({}).fetcher(url, o)));
  assert.equal(retry.messages.length, 0); assert.equal(n, 3);
  for (const ra of ['3600', 'Wed, 21 Oct 2026 07:28:00 GMT', '-1', null]) {
    let c = 0;
    await assert.rejects(() => scanMailbox('t', alias, async () => { c++; return new Response('', {status:429, headers:ra ? {'Retry-After':ra} : {}}); }), /membatasi/);
    assert.equal(c, 1);
  }
  let always = 0;
  await assert.rejects(() => scanMailbox('t', alias, async () => { always++; return new Response('', {status:429, headers:{'Retry-After':'0'}}); }), /membatasi/);
  assert.equal(always, LIMITS.retries+1);
  await assert.rejects(() => scanMailbox('t', alias, async () => { throw new DOMException('timeout', 'TimeoutError'); }), e => e.status === 504);
  await assert.rejects(() => graphGet('t', GRAPH+'/me', {fetcher:async () => assert.fail('no fetch after deadline'), deadline:Date.now()-1}), e => e.status === 504);
  await assert.rejects(() => scanMailbox('t', alias, async () => new Response('', {status:401})), e => e.status === 503 && /Outlook/.test(e.message));
  await assert.rejects(() => scanMailbox('t', alias, async () => new Response('secret detail', {status:500})), e => !/secret/.test(e.message));
});
test('Outlook state binds provider/purpose/owner session; malformed denied', () => {
  const owner = {email:OWNER, userId:OWNER, sessionId:'sid'}, state = {schema:2, provider:'microsoft', purpose:'outlook', mode:'connect', state:'n'.repeat(43), verifier:'v'.repeat(43), userId:OWNER, sessionId:'sid', exp:Date.now()+10000};
  const params = new URLSearchParams({state:state.state, code:'c'});
  validateOutlookState(state, params, owner);
  for (const patch of [{provider:'google'},{purpose:'sheets'},{mode:'login'},{verifier:''},{verifier:undefined},{state:'x'},{exp:Date.now()-1},{exp:Date.now()+700000},{sessionId:'other'},{sessionId:undefined},{userId:TEAM[0]},{schema:1}]) assert.throws(() => validateOutlookState({...state, ...patch}, params, owner), undefined, JSON.stringify(patch));
  assert.throws(() => validateOutlookState(null, params, owner));
  assert.throws(() => validateOutlookState(state, params, {email:TEAM[0], userId:TEAM[0], sessionId:'sid'}));
  assert.throws(() => validateOutlookState(state, new URLSearchParams({state:state.state}), owner));
  assert.throws(() => validateOutlookState(state, new URLSearchParams({state:state.state, code:'c', error:'access_denied'}), owner));
});

function redisFixture() {
  const data = new Map(), calls = [];
  const fetcher = async (url, options) => {
    const a = JSON.parse(options.body); calls.push(a);
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
  return {data, calls, fetcher};
}
test('routes: owner-only POST connect, PKCE/state one-use callback, mailbox pin, Sheets alias gate before Graph, Graph GET only', async () => {
  const previous = {...process.env}, previousFetch = globalThis.fetch, r = redisFixture(), network = [];
  let profile = {id:'mbx-1', mail:OUTLOOK_MAILBOX, userPrincipalName:OUTLOOK_MAILBOX}, sheetRows = [['Email','Nama','Status'],[alias,'Demo',''],['dup@mdprana.site','A',''],['dup@mdprana.site','B','']], tokenBody;
  for (const k of ['KV_REST_API_URL','KV_REST_API_TOKEN','TEAM_EMAILS']) delete process.env[k];
  Object.assign(process.env, env);
  globalThis.fetch = async (url, options = {}) => {
    url = String(url); network.push({url, method:options.method || 'GET'});
    if (url === env.UPSTASH_REDIS_REST_URL) return r.fetcher(url, options);
    if (url.startsWith('https://sheets.googleapis.com/')) {
      assert.equal(options.method, undefined);
      return Response.json(url.includes('batchGet') ? {valueRanges:[{values:sheetRows}]} : {sheets:[{properties:{title:'Synthetic'}}]});
    }
    if (url === 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token') { tokenBody = new URLSearchParams(options.body); return Response.json({access_token:'ms-access', refresh_token:'ms-refresh', expires_in:3600, scope:'https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read offline_access'}); }
    if (url.startsWith(GRAPH+'/me?')) { assert.equal(options.headers.Authorization, 'Bearer ms-access'); return Response.json(profile); }
    if (url.startsWith(GRAPH+'/me/')) return graph({inbox:[[msg('in', to(alias))]], junkemail:[[msg('junk', header('Delivered-To', alias)), msg('agg')]]}).fetcher(url, options);
    assert.fail('Unexpected external request '+url);
  };
  try {
    const sessions = sessionStore(), connect = await import('../app/api/auth/outlook/connect/route.js'), callback = await import('../app/api/auth/outlook/callback/route.js');
    const inbox = await import('../app/api/inbox/route.js'), sessionRoute = await import('../app/api/session/route.js');
    const req = (origin = env.APP_URL) => new Request(env.APP_URL+'/api/auth/outlook/connect', {method:'POST', headers:{...(origin ? {Origin:origin} : {}), 'Content-Type':'application/json'}, body:'{}'});
    const get = e => inbox.GET(new Request(env.APP_URL+'/api/inbox?email='+encodeURIComponent(e)));
    const graphCalls = () => network.filter(n => n.url.startsWith(GRAPH)).length;
    jarData.clear();
    assert.equal((await get(alias)).status, 401);
    assert.equal((await connect.POST(req())).status, 401);
    const memberId = await sessions.create({email:TEAM[0], sub:'member-sub', email_verified:true});
    jarData.set('agen_session_v2', memberId);
    assert.equal((await connect.POST(req())).status, 403);
    const ownerId = await sessions.create({email:OWNER, sub:'owner-sub', email_verified:true});
    jarData.set('agen_session_v2', ownerId);
    for (const origin of [null, 'https://evil.example']) assert.equal((await connect.POST(req(origin))).status, 403);
    assert.equal((await connect.POST(new Request(env.APP_URL+'/api/auth/outlook/connect', {method:'POST', headers:{Origin:env.APP_URL, 'Content-Type':'text/plain'}, body:'{}'}))).status, 415);
    assert.equal(r.data.has('agen:v2:connection:outlook'), false);
    assert.equal((await get(alias)).status, 503);
    assert.equal(graphCalls(), 0);
    const start = await connect.POST(req());
    assert.equal(start.status, 200); assert.equal(start.headers.get('cache-control'), 'no-store'); assert.equal(start.headers.get('location'), null);
    const location = new URL((await start.json()).authorizeUrl);
    assert.equal(location.origin+location.pathname, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
    assert.equal(location.searchParams.get('scope'), 'offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read');
    assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(location.searchParams.get('redirect_uri'), env.APP_URL+'/api/auth/outlook/callback');
    const sealed = jarData.get(STATE_COOKIE), state = unseal(sealed, env.SESSION_SECRET);
    assert.equal(location.searchParams.get('code_challenge').length, 43); assert.equal(location.toString().includes(state.verifier), false);
    const cb = (s = state.state, code = 'synthetic') => callback.GET(new Request(env.APP_URL+'/api/auth/outlook/callback?'+new URLSearchParams({state:s, code})));
    jarData.set('agen_session_v2', memberId);
    assert.match((await cb()).headers.get('location'), /outlook_failed/);
    jarData.set('agen_session_v2', ownerId); jarData.set(STATE_COOKIE, sealed);
    assert.match((await cb('forged')).headers.get('location'), /outlook_failed/);
    jarData.set(STATE_COOKIE, seal({...state, sessionId:memberId}, env.SESSION_SECRET));
    assert.match((await cb()).headers.get('location'), /outlook_failed/);
    assert.equal(network.some(n => n.url.includes('/token')), false);
    jarData.set(STATE_COOKIE, sealed);
    assert.equal((await cb()).headers.get('location'), env.APP_URL+'/');
    assert.equal(tokenBody.get('code_verifier'), state.verifier); assert.equal(tokenBody.get('redirect_uri'), env.APP_URL+'/api/auth/outlook/callback');
    assert.equal(jarData.has(STATE_COOKIE), false);
    const tokenCalls = network.filter(n => n.url.includes('/token')).length;
    jarData.set(STATE_COOKIE, sealed);
    assert.match((await cb()).headers.get('location'), /outlook_failed/);
    assert.equal(network.filter(n => n.url.includes('/token')).length, tokenCalls);
    const stored = r.data.get('agen:v2:connection:outlook');
    assert.ok(stored && !stored.includes('ms-refresh'));
    assert.equal(r.data.get('agen:v2:outlook:mailbox-id'), 'mbx-1');
    for (const p of [{id:'mbx-2', mail:OUTLOOK_MAILBOX, userPrincipalName:OUTLOOK_MAILBOX}, {id:'mbx-1', mail:'other@outlook.com', userPrincipalName:OUTLOOK_MAILBOX}, {id:'mbx-1', mail:null, userPrincipalName:OUTLOOK_MAILBOX}]) {
      profile = p; await connect.POST(req());
      assert.match((await cb(unseal(jarData.get(STATE_COOKIE), env.SESSION_SECRET).state)).headers.get('location'), /outlook_failed/);
      assert.equal(r.data.get('agen:v2:connection:outlook'), stored);
    }
    const ready = await (await sessionRoute.GET()).json();
    assert.equal(ready.outlookReady, true); assert.equal(ready.sheetsReady, false); assert.equal(ready.outlook.coverage, 'Inbox + Junk');
    assert.equal(/ms-access|ms-refresh|mbx-1|redis/.test(JSON.stringify(ready)), false);
    const before = graphCalls();
    assert.equal((await get(alias)).status, 503);
    assert.equal(graphCalls(), before);
    await connectionStore().write(ownerConnection({access_token:'g', refresh_token:'g', expires_in:3600, scope:DATA_SCOPES.join(' ')}, {email:OWNER, userId:OWNER, sub:'owner-sub'}));
    for (const [address, status] of [['absent@mdprana.site', 404], ['dup@mdprana.site', 409], ['1nd0n3s1aemas+agent@gmail.com', 400], ['agent@mdprana.site OR all', 400], ['agent@evil.com', 400]]) {
      const res = await get(address); assert.equal(res.status, status, address); assert.ok((await res.json()).error);
    }
    assert.equal(graphCalls(), before);
    jarData.set('agen_session_v2', memberId);
    const ok = await get(alias); assert.equal(ok.status, 200);
    const data = await ok.json();
    assert.deepEqual(data.messages.map(m => m.id).sort(), ['in','junk']); assert.equal(data.limited, false); assert.equal(data.coverage, 'Inbox + Junk');
    assert.equal(JSON.stringify(data).includes('ms-access'), false);
    assert.ok(network.filter(n => n.url.startsWith(GRAPH)).every(n => n.method === 'GET'));
    assert.equal(network.some(n => /linkumkm|gmail\.googleapis|evil/.test(n.url)), false);
    r.data.set('agen:v2:connection:outlook', seal({...unseal(stored, env.SESSION_SECRET), sub:'mbx-2'}, env.SESSION_SECRET));
    assert.equal((await get(alias)).status, 503);
    await sessions.revokeAll(TEAM[0]);
    assert.equal((await get(alias)).status, 401);
    assert.equal(r.calls.some(a => String(a[1]).startsWith('agen:google:')), false);
  } finally {
    globalThis.fetch = previousFetch; jarData.clear();
    for (const k of Object.keys(process.env)) if (!(k in previous)) delete process.env[k];
    Object.assign(process.env, previous);
  }
});
