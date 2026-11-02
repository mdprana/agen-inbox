import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { passwordStore, hashPassword, verifyPassword, passwordInput, passwordRecord, SCRYPT, admittedHash, trustedIP, passwordEnabled } from './password-auth.js';
import { digest, PASSWORD_LIMIT, PASSWORD_ADMIT, PASSWORD_UPDATE } from './redis.js';
import { sessionStore, TEAM } from './team-auth.js';
import { OWNER } from './helpers.js';
const env = {SESSION_SECRET:'s'.repeat(32), APP_URL:'http://localhost:3109', PASSWORD_LOGIN_ENABLED:'true', VERCEL:'1', UPSTASH_REDIS_REST_URL:'https://redis.example', UPSTASH_REDIS_REST_TOKEN:'synthetic-only'};
const password = '  fifteen chars 漢  ', ip = '192.0.2.1', member = TEAM[0];
const userKey = address => `agen:v2:user:${digest(address)}`;
const tokenKey = token => `agen:v2:password:token:${digest(token)}`;
function fixture() {
  const data = new Map(), expiry = new Map(), sets = new Map(), calls = [];
  let now = Date.now(), down = false, failUpdate = false, globalBusy = false;
  function get(key) { if (expiry.has(key) && expiry.get(key) <= now) { data.delete(key); sets.delete(key); expiry.delete(key); } return data.get(key) ?? null; }
  const fetcher = async (url, options) => {
    assert.equal(url, env.UPSTASH_REDIS_REST_URL);
    if (down) throw new Error('private storage detail');
    const a = JSON.parse(options.body); calls.push(a);
    let result;
    if (a[0] === 'GET') result = get(a[1]);
    else if (a[0] === 'SET') {
      get(a[1]);
      if (a.includes('NX') && data.has(a[1])) result = null;
      else { data.set(a[1],a[2]); if (a.includes('PX')) expiry.set(a[1],now+Number(a[a.indexOf('PX')+1])); result = 'OK'; }
    } else if (a[0] === 'DEL') result = Number(data.delete(a[1]));
    else if (a[0] === 'ZREM') result = Number(sets.get(a[1])?.delete(a[2]) || false);
    else if (a[0] === 'EVAL' && a[1] === PASSWORD_LIMIT) {
      const keys = a.slice(3,5), nonce = a[5];
      for (const k of keys) { get(k); if (!sets.has(k)) sets.set(k,new Map()); for (const [n,score] of sets.get(k)) if (score <= now-900000) sets.get(k).delete(n); }
      if (sets.get(keys[0]).size >= 5 || sets.get(keys[1]).size >= 20) result = 0;
      else { for (const k of keys) { sets.get(k).set(nonce,now); expiry.set(k,now+900000); } result = 1; }
    } else if (a[0] === 'EVAL' && a[1] === PASSWORD_ADMIT) {
      const k = a[3]; get(k); if (!sets.has(k)) sets.set(k,new Map());
      for (const [n,score] of sets.get(k)) if (score <= now) sets.get(k).delete(n);
      if (globalBusy || sets.get(k).size >= 1) result = 0;
      else { sets.get(k).set(a[4],now+600000); expiry.set(k,now+600000); result = 1; }
    } else if (a[0] === 'EVAL' && a[1] === PASSWORD_UPDATE) {
      const [uk,tk,old,next,traw] = a.slice(3);
      if (failUpdate || (get(uk) || '') !== old || (traw && (get(tk) !== traw || JSON.parse(traw).exp <= now))) result = 0;
      else { data.set(uk,next); if (traw) data.delete(tk); result = 1; }
    } else if (a[0] === 'EVAL' && a[1].includes('authVersion')) {
      const u = JSON.parse(get(a[3])); if (u) { u.authVersion++; data.set(a[3],JSON.stringify(u)); result = 1; } else result = 0;
    } else assert.fail('Unexpected command '+a[0]);
    return Response.json({result});
  };
  const command = async a => (await (await fetcher(env.UPSTASH_REDIS_REST_URL,{body:JSON.stringify(a)})).json()).result;
  return {data, expiry, sets, calls, fetcher, command, store:passwordStore(env,fetcher), sessions:sessionStore(env,fetcher), advance(ms) { now += ms; }, set down(v) { down = v; }, set failUpdate(v) { failUpdate = v; }, set globalBusy(v) { globalBusy = v; }};
}
async function owner(f) { return f.sessions.read(await f.sessions.create({email:OWNER,sub:'owner-sub',email_verified:true})); }
let hash;
test('scrypt exact parameters, random salt, constant-length key; Unicode/spaces preserved and input/corruption denied', async t => {
  assert.deepEqual(SCRYPT,{N:131072,r:8,p:1,maxmem:268435456});
  const start = performance.now(), before = process.memoryUsage().rss;
  let peak = before; const timer = setInterval(() => { peak = Math.max(peak,process.memoryUsage().rss); },5);
  try { hash = await hashPassword(password); } finally { clearInterval(timer); }
  t.diagnostic(JSON.stringify({hashMs:Math.round(performance.now()-start),baselineRSS:before,peakRSS:peak,maxRSSKiB:process.resourceUsage().maxRSS}));
  assert.equal(hash.salt.length,32); assert.equal(hash.key.length,128);
  assert.equal(await verifyPassword(password,hash),true);
  assert.equal(await verifyPassword('wrong password long enough',hash),false);
  assert.equal(await verifyPassword(password.trim(),hash),false);
  assert.notEqual((await hashPassword(password)).salt,hash.salt);
  for (const v of [null,42,'x'.repeat(14),'x'.repeat(129),'漢'.repeat(43),'\ud800'.repeat(15)]) assert.throws(() => passwordInput(v));
  passwordInput('x'.repeat(128)); passwordInput('漢'.repeat(15)); passwordInput('\u{1F600}'.repeat(15)); passwordInput(' '.repeat(15));
  for (const patch of [{version:2},{N:16384},{r:1},{p:2},{maxmem:1},{salt:'00'},{key:'00'},{extra:true}]) assert.throws(() => passwordRecord({...hash,...patch}));
  assert.equal(passwordEnabled({}),false); assert.equal(passwordEnabled({PASSWORD_LOGIN_ENABLED:'TRUE'}),false);
});
test('single local/global inflight admission, expiry and failed storage/save/release fail closed', async () => {
  const f = fixture(); let release, enter;
  const entered = new Promise(r => { enter = r; }), wait = new Promise(r => { release = r; });
  const first = admittedHash(f.command,async () => { enter(); await wait; return 1; }); await entered;
  await assert.rejects(() => admittedHash(f.command,() => assert.fail()), {status:429});
  release(); assert.equal(await first,1);
  f.globalBusy = true; await assert.rejects(() => admittedHash(f.command,() => assert.fail()), {status:429}); f.globalBusy = false;
  f.sets.set('agen:v2:password:inflight',new Map([['other-worker',Date.now()+600000]]));
  await assert.rejects(() => admittedHash(f.command,() => assert.fail()),{status:429}); f.advance(600001);
  assert.equal(await admittedHash(f.command,async () => 2),2);
  await assert.rejects(() => admittedHash(f.command,async () => { throw new Error('hash failed'); }),/hash failed/);
  f.down = true; await assert.rejects(() => admittedHash(f.command,() => assert.fail())); f.down = false;
  await assert.rejects(() => admittedHash(f.command,async () => { f.sets.clear(); }),{status:503});
});
test('enrollment requires recent exact Google identity, cannot replace password; login/session fixation and reset revoke all methods', async () => {
  const f = fixture(), own = await owner(f), gid = await f.sessions.create({email:member,sub:'member-sub',email_verified:true}), identity = await f.sessions.read(gid);
  for (const patch of [{created:Date.now()-600001},{authMethod:'password'},{sub:'wrong'},{authVersion:99},{email:'jderchild@gmail.com'}]) await assert.rejects(() => f.store.enroll({...identity,...patch},password,ip));
  f.advance(900001);
  await f.store.enroll(identity,password,ip);
  await assert.rejects(() => f.sessions.read(gid));
  await assert.rejects(() => f.store.enroll(identity,password,ip));
  const id = await f.store.login('  APRILLIAWANDA13@gmail.com ',password,ip), session = await f.sessions.read(id);
  assert.equal(session.authMethod,'password'); assert.equal(session.sub,member); assert.notEqual(id,gid);
  assert.notEqual(await f.store.login(member,password,ip),id);
  const newGoogle = await f.sessions.create({email:member,sub:'member-sub',email_verified:true});
  const token = await f.store.issue(own,member,'reset',ip); assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  await f.store.consume(member,token,'reset','new password fifteen chars',ip);
  await assert.rejects(() => f.sessions.read(id)); await assert.rejects(() => f.sessions.read(newGoogle));
  await assert.rejects(() => f.store.consume(member,token,'reset',password,ip));
  const fresh = await f.store.login(member,'new password fifteen chars',ip);
  assert.equal((await f.sessions.read(fresh)).email,member);
  await f.sessions.revokeAll(member); await assert.rejects(() => f.sessions.read(fresh));
});
test('invites are digest-only purpose/user/expiry/version bound; no bootstrap, public signup or owner self recovery', async () => {
  const f = fixture(), own = await owner(f);
  for (const identity of [null,{...own,email:member,userId:member},{...own,email:member,userId:member,created:Date.now()-600001}]) assert.equal(await f.store.issue(identity,member,'invite',ip),null);
  await assert.rejects(() => f.store.issue({...own,created:Date.now()-600001},member,'invite',ip),{status:403,message:'Sesi Google pemilik lebih dari 10 menit. Keluar, masuk lagi dengan Google, lalu buat tautan.'});
  f.sets.clear(); await assert.rejects(() => f.store.issue(own,OWNER,'invite',ip),{status:409,message:'Akun pemilik tidak bisa diundang.'});
  for (const email of ['outsider@gmail.com','jderchild@gmail.com','1nd0n3s1aemas@gmail.com','aprilliawanda13+tag@gmail.com','aprillia.wanda13@gmail.com']) {
    f.sets.clear(); await assert.rejects(() => f.store.issue(own,email,'invite',ip),{status:409,message:'Email ini belum ada di daftar tim.'});
  }
  f.advance(900001);
  await assert.rejects(() => f.store.issue(own,member,'reset',ip),{status:409,message:'Akun ini belum punya kata sandi. Pilih Undangan.'});
  const token = await f.store.issue(own,member,'invite',ip), saved = f.data.get(tokenKey(token));
  assert.ok(saved); assert.equal([...f.data.values()].some(v => v.includes(token)),false);
  assert.ok(f.expiry.get(tokenKey(token)) >= Date.now()+1790000);
  for (const [email,purpose] of [[member,'reset'],[TEAM[1],'invite'],['outsider@gmail.com','invite'],[member,'bad']]) await assert.rejects(() => f.store.consume(email,token,purpose,password,ip));
  const expired = {...JSON.parse(saved),exp:Date.now()-1}; f.data.set(tokenKey(token),JSON.stringify(expired));
  await assert.rejects(() => f.store.consume(member,token,'invite',password,ip));
  f.data.set(tokenKey(token),saved); f.advance(1);
  f.failUpdate = true; await assert.rejects(() => f.store.consume(member,token,'invite',password,ip)); assert.equal(f.data.get(tokenKey(token)),saved); assert.equal(f.data.has(userKey(member)),false);
  f.failUpdate = false;
  await f.store.consume(member,token,'invite',password,ip);
  assert.equal(f.data.has(tokenKey(token)),false); assert.equal(JSON.parse(f.data.get(userKey(member))).googleSub,null);
  await assert.rejects(() => f.store.issue(own,member,'invite',ip),{status:409,message:'Akun ini sudah punya kata sandi. Pilih Reset.'});
  await assert.rejects(() => f.store.consume(member,token,'invite',password,ip));
  await assert.rejects(() => f.sessions.create({email:member,sub:'unapproved-link',email_verified:true}));
  assert.equal((await f.sessions.read(await f.store.login(member,password,ip))).email,member);
});
test('unknown/wrong/corrupt passwords generic; durable account/IP limits admit atomically and blocked retries do not extend window', async () => {
  const f = fixture();
  f.data.set(userKey(member),JSON.stringify({schema:2,userId:member,email:member,googleSub:null,authVersion:1,password:hash}));
  for (const email of [member,TEAM[1],'outsider@gmail.com']) await assert.rejects(() => f.store.login(email,'wrong password long enough',ip),{message:'Kredensial tidak valid.',status:401});
  const corrupted = JSON.parse(f.data.get(userKey(member))); corrupted.password.N = 1; f.data.set(userKey(member),JSON.stringify(corrupted));
  await assert.rejects(() => f.store.login(member,password,ip),{message:'Kredensial tidak valid.',status:401});
  const key = 'agen:v2:password:login:account:'+digest(member);
  f.sets.set(key,new Map(Array.from({length:5},(_,i) => [String(i),Date.now()]))); f.expiry.set(key,Date.now()+900000);
  const expiry = f.expiry.get(key); f.advance(10000);
  const denied = await Promise.allSettled(Array.from({length:20},() => f.store.login(member,password,ip)));
  assert.equal(denied.every(v => v.status === 'rejected' && v.reason.status === 429),true); assert.equal(f.expiry.get(key),expiry);
  f.advance(900001);
  const ipKey = 'agen:v2:password:login:ip:'+digest(ip);
  f.sets.set(ipKey,new Map(Array.from({length:20},(_,i) => [String(i),Date.now()+910001]))); f.expiry.delete(ipKey);
  await assert.rejects(() => f.store.login(TEAM[2],password,ip),{status:429});
  f.down = true; await assert.rejects(() => f.store.login(member,password,ip),{status:503});
  assert.equal(f.calls.some(a => a[0] === 'EVAL' && a[1] === PASSWORD_LIMIT),true);
});
test('token double consume and stale user CAS prevent concurrent replay/credential overwrite', async () => {
  const f = fixture(), own = await owner(f), token = await f.store.issue(own,member,'invite',ip);
  const attempts = await Promise.allSettled([f.store.consume(member,token,'invite',password,ip),f.store.consume(member,token,'invite',password,ip)]);
  assert.equal(attempts.filter(v => v.status === 'fulfilled').length,1);
  assert.equal(f.data.has(tokenKey(token)),false);
  const raw = f.data.get(userKey(member)), next = JSON.stringify({...JSON.parse(raw),authVersion:99});
  assert.equal(await f.command(['EVAL',PASSWORD_UPDATE,'2',userKey(member),tokenKey(token),'stale',next,'']),0);
  assert.equal(f.data.get(userKey(member)),raw);
  const tk = tokenKey('t'.repeat(43)), traw = JSON.stringify({exp:Date.now()+10000}); f.data.set(tk,traw);
  const commits = await Promise.all([1,2].map(() => f.command(['EVAL',PASSWORD_UPDATE,'2',userKey(member),tk,raw,next,traw])));
  assert.equal(commits.reduce((a,b) => a+b,0),1); assert.equal(f.data.has(tk),false);
  f.data.set(tk,JSON.stringify({exp:1}));
  assert.equal(await f.command(['EVAL',PASSWORD_UPDATE,'2',userKey(member),tk,next,raw,f.data.get(tk)]),0);
  assert.equal(f.data.get(userKey(member)),next);
});
test('atomic limiter across command clients caps account at five and IP at twenty; issuance/token expiry/version fail closed', async () => {
  const f = fixture();
  const sameAccount = await Promise.all(Array.from({length:100},(_,i) => f.command(['EVAL',PASSWORD_LIMIT,'2','account','ip:'+i,String(i)])));
  assert.equal(sameAccount.reduce((a,b) => a+b,0),5);
  const sameIP = await Promise.all(Array.from({length:100},(_,i) => f.command(['EVAL',PASSWORD_LIMIT,'2','account:'+i,'shared-ip',String(i)])));
  assert.equal(sameIP.reduce((a,b) => a+b,0),20);
  const own = await owner(f);
  for (let i = 0; i < 5; i++) assert.ok(await f.store.issue(own,member,'invite',ip));
  const ttlKey = 'agen:v2:password:issue:account:'+digest(OWNER), expiry = f.expiry.get(ttlKey);
  await assert.rejects(() => f.store.issue(own,member,'invite',ip),{status:429}); assert.equal(f.expiry.get(ttlKey),expiry);
  f.advance(900001);
  const token = await f.store.issue(own,member,'invite',ip);
  f.data.set(userKey(member),JSON.stringify({schema:2,userId:member,email:member,googleSub:null,authVersion:2}));
  await assert.rejects(() => f.store.consume(member,token,'invite',password,ip));
  f.data.delete(userKey(member)); f.advance(1800001);
  await assert.rejects(() => f.store.consume(member,token,'invite',password,ip));
  assert.equal(f.data.has(userKey(member)),false);
});
test('trusted IP ignores spoofable forwarding headers and requires verified Vercel ingress', () => {
  const req = headers => new Request(env.APP_URL,{headers});
  for (const headers of [{},{'x-forwarded-for':ip},{'x-real-ip':ip},{forwarded:'for='+ip},{'x-vercel-forwarded-for':ip+', 1.1.1.1'},{'x-vercel-forwarded-for':'garbage'}]) assert.throws(() => trustedIP(req(headers),env),{status:503});
  assert.throws(() => trustedIP(req({'x-vercel-forwarded-for':ip}),{}),{status:503});
  assert.equal(trustedIP(req({'x-vercel-forwarded-for':ip,'x-forwarded-for':'evil'}),env),ip);
  assert.equal(trustedIP(req({'x-vercel-forwarded-for':'2001:db8::1'}),env),'2001:db8::1');
});
const jarData = new Map(), jarOpts = new Map();
globalThis.__j3Cookies = {get:name => jarData.has(name) ? {value:jarData.get(name)} : undefined,set:(name,value,opts) => {jarData.set(name,value); jarOpts.set(name,opts);},delete:name => jarData.delete(name)};
registerHooks({resolve(specifier, context, next) {
  if (specifier === 'next/headers') return {url:'data:text/javascript,export async function cookies(){return globalThis.__j3Cookies}',shortCircuit:true};
  return next(specifier,context);
}});
test('four POST routes guard Origin/content/body/action/default-off; password session independent from OAuth; no secret responses', async () => {
  const previous = {...process.env}, oldFetch = globalThis.fetch, f = fixture();
  for (const k of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET']) delete process.env[k];
  Object.assign(process.env,env); globalThis.fetch = f.fetcher; jarData.clear();
  try {
    const routes = await Promise.all(['','/enroll','/invite','/reset'].map(p => import('../app/api/auth/password'+p+'/route.js')));
    const auth = await import('./auth.js'), session = await import('../app/api/session/route.js'), logout = await import('../app/api/auth/logout/route.js');
    const req = (body = {},headers = {}) => new Request(env.APP_URL+'/api/auth/password',{method:'POST',headers:{Origin:env.APP_URL,'Content-Type':'application/json','x-vercel-forwarded-for':ip,...headers},body:typeof body === 'string' ? body : JSON.stringify(body)});
    for (const route of routes) {
      for (const origin of ['', 'https://evil.example']) assert.equal((await route.POST(req({}, {Origin:origin}))).status,403);
      assert.equal((await route.POST(req({}, {'Content-Type':'text/plain'}))).status,415);
      assert.equal((await route.POST(req('x'.repeat(4097)))).status,400);
      assert.equal((await route.POST(req('[]'))).status,400);
      delete process.env.PASSWORD_LOGIN_ENABLED;
      assert.equal((await route.POST(req())).status,503);
      process.env.PASSWORD_LOGIN_ENABLED = 'true';
    }
    const stalled = new Request(env.APP_URL+'/api/auth/password',{method:'POST',headers:{Origin:env.APP_URL,'Content-Type':'application/json'},body:new ReadableStream({start() {}}),duplex:'half'});
    assert.equal((await routes[0].POST(stalled)).status,400);
    assert.equal((await routes[0].POST(req({}, {'x-vercel-forwarded-for':'spoofed'}))).status,503);
    assert.equal((await routes[1].POST(req({action:'bad'}))).status,400);
    assert.equal((await routes[3].POST(req({action:'bad'}))).status,400);
    for (const [route,body] of [[routes[2],{email:member}],[routes[3],{action:'issue',email:member}]]) assert.deepEqual(await (await route.POST(req(body))).json(),{ok:true});
    const own = await owner(f); jarData.set(auth.SESSION_COOKIE,own.sessionId);
    const invitation = await (await routes[2].POST(req({email:member}))).json(); assert.ok(invitation.token);
    assert.equal((await routes[1].POST(req({action:'invite',email:member,token:invitation.token,password}))).status,200);
    const login = await routes[0].POST(req({email:member,password})); assert.equal(login.status,200); assert.deepEqual(await login.json(),{ok:true});
    assert.equal(jarOpts.get(auth.SESSION_COOKIE).maxAge,604800);
    const id = jarData.get(auth.SESSION_COOKIE); assert.notEqual(id,own.sessionId); await assert.rejects(() => f.sessions.read(own.sessionId));
    assert.equal((await auth.requireIdentity()).email,member);
    const safe = await (await session.GET()).json(); assert.equal(safe.email,member); assert.equal(safe.passwordEnabled,true);
    for (const secret of [password,hash.key,invitation.token,id,env.UPSTASH_REDIS_REST_TOKEN]) assert.equal(JSON.stringify(safe).includes(secret),false);
    delete process.env.PASSWORD_LOGIN_ENABLED; await assert.rejects(() => auth.requireIdentity());
    process.env.PASSWORD_LOGIN_ENABLED = 'true';
    await f.sessions.revokeAll(member); await assert.rejects(() => auth.requireIdentity());
    const next = await f.store.login(member,password,ip); await auth.setSessionId(next,{persistent:false});
    assert.equal('maxAge' in jarOpts.get(auth.SESSION_COOKIE),false); assert.equal(jarOpts.get(auth.SESSION_COOKIE).httpOnly,true);
    assert.equal((await logout.POST(req())).status,200); await assert.rejects(() => f.sessions.read(next));
    assert.equal(f.calls.some(a => a[1]?.startsWith('agen:google:')),false);
  } finally {
    globalThis.fetch = oldFetch; jarData.clear();
    for (const k of Object.keys(process.env)) if (!(k in previous)) delete process.env[k];
    Object.assign(process.env,previous);
  }
});
test('INVITE_ADMIN_SECRET Bearer issues without owner identity/Origin; wrong 401; unset/short ignored; outsider denied', async () => {
  const previous = {...process.env}, oldFetch = globalThis.fetch, f = fixture(), secret = 'a'.repeat(32);
  Object.assign(process.env,env,{INVITE_ADMIN_SECRET:secret}); globalThis.fetch = f.fetcher; jarData.clear();
  try {
    const [invite,reset] = await Promise.all(['/invite','/reset'].map(p => import('../app/api/auth/password'+p+'/route.js')));
    const req = (body,headers = {}) => new Request(env.APP_URL+'/api/auth/password',{method:'POST',headers:{'Content-Type':'application/json','x-vercel-forwarded-for':ip,...headers},body:JSON.stringify(body)});
    const bearer = s => ({authorization:'Bearer '+s});
    for (const email of [OWNER,member]) {
      const res = await invite.POST(req({email},bearer(secret))), json = await res.json();
      assert.equal(res.status,200); assert.deepEqual(Object.keys(json).sort(),['ok','token']); assert.match(json.token,/^[A-Za-z0-9_-]{43}$/);
      assert.equal(JSON.parse(f.data.get(tokenKey(json.token))).userId,email);
    }
    const outsider = await invite.POST(req({email:'outsider@gmail.com'},bearer(secret)));
    assert.equal(outsider.status,409); assert.deepEqual(await outsider.json(),{error:'Email ini belum ada di daftar tim.'});
    f.data.set(userKey(member),JSON.stringify({schema:2,userId:member,email:member,googleSub:null,authVersion:2,password:hash}));
    const r = await (await reset.POST(req({action:'issue',email:member},bearer(secret)))).json(); assert.ok(r.token);
    assert.equal((await reset.POST(req({action:'consume',email:member},bearer(secret)))).status,403);
    const before = f.data.size;
    for (const route of [invite,reset]) {
      const res = await route.POST(req({action:'issue',email:member},bearer(secret+'x')));
      assert.equal(res.status,401); assert.equal('token' in await res.json(),false);
    }
    assert.equal(f.data.size,before);
    for (const value of [undefined,'short']) {
      if (value) process.env.INVITE_ADMIN_SECRET = value; else delete process.env.INVITE_ADMIN_SECRET;
      assert.equal((await invite.POST(req({email:member},bearer(value || secret)))).status,403);
      assert.deepEqual(await (await invite.POST(req({email:member},{...bearer(value || secret),Origin:env.APP_URL}))).json(),{ok:true});
    }
  } finally {
    globalThis.fetch = oldFetch; jarData.clear();
    for (const k of Object.keys(process.env)) if (!(k in previous)) delete process.env[k];
    Object.assign(process.env,previous);
  }
});
