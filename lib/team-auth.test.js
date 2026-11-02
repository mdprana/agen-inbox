import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { OWNER, seal, unseal } from './helpers.js';
import { TEAM, allowedEmail, verifiedIdentity, identitySession, sessionStore, ownerConnect, validateState, connectionStore, ownerConnection, freshConnection, DATA_SCOPES } from './team-auth.js';
import { redis, digest, storageConfig } from './redis.js';
const env = {SESSION_SECRET:'s'.repeat(32), APP_URL:'http://localhost:3109', GOOGLE_CLIENT_ID:'test-client', GOOGLE_CLIENT_SECRET:'test-secret', UPSTASH_REDIS_REST_URL:'https://redis.example', UPSTASH_REDIS_REST_TOKEN:'test-only'};
const profile = (email = OWNER, sub = 'owner-sub') => ({email, sub, email_verified:true});
const tokens = {access_token:'test-access', refresh_token:'test-refresh', expires_in:3600, scope:DATA_SCOPES.join(' ')};
function fixture() {
  const data = new Map(), calls = [];
  let down = false, failSave = false;
  const fetcher = async (url, options) => {
    assert.equal(url, env.UPSTASH_REDIS_REST_URL);
    assert.match(options.headers.Authorization, /^Bearer /);
    if (down) throw new Error('private provider detail');
    const a = JSON.parse(options.body); calls.push(a);
    let result;
    if (a[0] === 'GET') result = data.get(a[1]) ?? null;
    else if (a[0] === 'SET') {
      if (failSave && a[1] === 'agen:v2:connection:sheets') result = null;
      else if (a.includes('NX') && data.has(a[1])) result = null;
      else { data.set(a[1], a[2]); result = 'OK'; }
    } else if (a[0] === 'DEL') result = Number(data.delete(a[1]));
    else if (a[0] === 'EVAL') {
      const key = a[3];
      if (a[1].includes('KEYS[2]')) {
        if (!failSave && data.get(a[4]) === a[5]) { data.set(a[3],a[6]); result = 1; } else result = 0;
      } else if (a[1].includes('authVersion')) {
        const user = JSON.parse(data.get(key) || 'null');
        if (user) { user.authVersion++; data.set(key, JSON.stringify(user)); result = 1; } else result = 0;
      } else if (data.get(key) === a[4]) { data.delete(key); result = 1; } else result = 0;
    } else assert.fail(`Unexpected command ${a[0]}`);
    return Response.json({result});
  };
  return {data, calls, fetcher, sessions:sessionStore(env, fetcher), store:connectionStore(env, fetcher), set down(v) { down = v; }, set failSave(v) { failSave = v; }};
}
test('five exact verified identities only; no env expansion, dot/plus equivalence or legacy schema', () => {
  for (const email of TEAM) assert.equal(verifiedIdentity(profile(email)).email, email);
  for (const email of ['1nd0n3s1aemas@gmail.com','jderchild+tag@gmail.com','ind0n3s1aemas@outlook.com','outsider@gmail.com','madepranajaya01+tag@gmail.com','made.pranajaya01@gmail.com','MADEPRANAJAYA01@gmail.com',' madepranajaya01@gmail.com']) {
    assert.equal(allowedEmail(email, {TEAM_EMAILS:email}), false);
    assert.throws(() => verifiedIdentity(profile(email)));
  }
  for (const bad of [{email_verified:false},{sub:''},{sub:' '},{sub:undefined},{sub:123}]) assert.throws(() => verifiedIdentity({...profile(), ...bad}));
  assert.throws(() => identitySession({kind:'identity', ...profile(), exp:Date.now()+10000}));
  assert.equal(DATA_SCOPES.some(s => s.includes('gmail')), false);
});
test('opaque hashed server sessions pin provider sub; revoke, delete, expired and corrupt deny', async () => {
  const f = fixture(), id = await f.sessions.create(profile()), key = `agen:v2:session:${digest(id)}`;
  assert.match(id, /^[A-Za-z0-9_-]{43}$/);
  const session = await f.sessions.read(id);
  assert.equal(session.userId, OWNER); assert.equal(session.access_token, undefined);
  assert.equal(f.calls.some(a => a[1]?.includes(id)), false);
  await assert.rejects(() => f.sessions.create(profile(OWNER, 'changed-sub')));
  await assert.rejects(() => f.sessions.read('legacy-cookie'));
  const original = f.data.get(key);
  for (const patch of [{email:'jderchild@gmail.com'},{authMethod:'password'},{sub:'wrong'},{exp:Date.now()-1},{exp:Date.now()+700000000},{created:Date.now()+10000},{authVersion:0},{schema:1},{userId:'outsider@gmail.com'}]) {
    f.data.set(key, JSON.stringify({...JSON.parse(original), ...patch}));
    await assert.rejects(() => f.sessions.read(id));
  }
  f.data.set(key, original);
  await f.sessions.revokeAll(OWNER);
  await assert.rejects(() => f.sessions.read(id));
  const next = await f.sessions.create(profile());
  assert.notEqual(next, id);
  await f.sessions.remove(next); await assert.rejects(() => f.sessions.read(next));
  f.down = true; await assert.rejects(() => f.sessions.read(id), /Penyimpanan/);
  assert.equal(f.calls.some(a => a[1] === `agen:google:${OWNER}`), false);
});
test('password sessions use same durable user/version; default-off rejects without changing Google sessions', async () => {
  const f = fixture(), googleId = await f.sessions.create(profile());
  const key = `agen:v2:user:${digest(OWNER)}`, user = JSON.parse(f.data.get(key));
  f.data.set(key,JSON.stringify({...user,password:{version:1}}));
  const enabled = sessionStore({...env,PASSWORD_LOGIN_ENABLED:'true'},f.fetcher);
  await assert.rejects(() => f.sessions.createPassword(OWNER,user.authVersion));
  await assert.rejects(() => enabled.createPassword(OWNER,user.authVersion+1));
  const id = await enabled.createPassword(OWNER,user.authVersion);
  assert.equal((await enabled.read(id)).authMethod,'password');
  await assert.rejects(() => f.sessions.read(id));
  assert.equal((await f.sessions.read(googleId)).authMethod,'google');
  await enabled.ownerBinding(await enabled.read(id),'owner-sub');
  await enabled.revokeAll(OWNER);
  await assert.rejects(() => enabled.read(id)); await assert.rejects(() => enabled.read(googleId));
});
test('owner connect state binds purpose/provider/local user/session and PKCE; malformed states deny', async () => {
  const f = fixture(), id = await f.sessions.create(profile()), owner = await f.sessions.read(id);
  const memberId = await f.sessions.create(profile(TEAM[0], 'member-sub')), member = await f.sessions.read(memberId);
  ownerConnect(owner); assert.throws(() => ownerConnect(member));
  const state = {schema:2, provider:'google', purpose:'sheets', mode:'connect', state:'n'.repeat(43), verifier:'v'.repeat(43), userId:OWNER, sessionId:id, exp:Date.now()+10000};
  const params = new URLSearchParams({state:state.state, code:'test-code'});
  assert.equal(validateState(state, params, owner), 'connect');
  for (const patch of [{provider:'outlook'},{purpose:'identity'},{mode:'other'},{verifier:''},{verifier:'bad'},{exp:Date.now()-1},{exp:NaN},{sessionId:'different'},{userId:TEAM[0]},{schema:1}]) assert.throws(() => validateState({...state, ...patch}, params, owner));
  assert.throws(() => validateState(state, params, member));
  assert.throws(() => validateState(state, new URLSearchParams({state:'wrong',code:'x'}), owner));
  assert.throws(() => validateState(state, new URLSearchParams({state:state.state,code:'x',error:'denied'}), owner));
  const login = {...state, mode:'login', purpose:'identity', userId:undefined, sessionId:undefined};
  assert.equal(validateState(login, params, null), 'login');
  assert.throws(() => validateState(login, params, owner));
});
test('sealed Sheets only: purpose, owner, subject, expiry, tamper and storage checks', async () => {
  const f = fixture();
  await f.sessions.create(profile());
  const identity = {email:OWNER, userId:OWNER, sub:'owner-sub'};
  const value = ownerConnection(tokens, identity);
  await f.store.write(value);
  const key = 'agen:v2:connection:sheets', saved = f.data.get(key);
  assert.ok(!saved.includes(tokens.refresh_token)); assert.deepEqual(unseal(saved, env.SESSION_SECRET), value);
  assert.deepEqual(await f.store.read(), value);
  assert.ok(f.calls.some(a => a[0] === 'SET' && a[1] === key && a[3] === 'PX'));
  for (const patch of [{purpose:'outlook'},{provider:'microsoft'},{owner:TEAM[0]},{email:TEAM[0]},{sub:'wrong'},{sub:''},{schema:1},{exp:Date.now()-1},{exp:Date.now()+181*86400000},{expires_at:null},{refresh_token:''}]) {
    f.data.set(key, seal({...value, ...patch}, env.SESSION_SECRET)); await assert.rejects(() => f.store.read());
  }
  f.data.set(key, saved.slice(0,-5)+'xxxxx'); await assert.rejects(() => f.store.read());
  f.data.delete(key); f.data.set(`agen:google:${OWNER}`, saved); await assert.rejects(() => f.store.read());
  assert.throws(() => ownerConnection(tokens, {email:TEAM[0],userId:TEAM[0],sub:'member'}));
  assert.throws(() => ownerConnection({...tokens,scope:'openid email'}, identity));
  assert.throws(() => ownerConnection({...tokens,refresh_token_expires_in:0}, identity));
  f.down = true; await assert.rejects(() => f.store.read(), /Penyimpanan/);
  assert.equal(storageConfig({KV_REST_API_URL:env.UPSTASH_REDIS_REST_URL,KV_REST_API_TOKEN:'test'}).length, 0);
  assert.notEqual(storageConfig({KV_REST_API_URL:env.UPSTASH_REDIS_REST_URL,KV_REST_API_READ_ONLY_TOKEN:'test'}).length, 0);
  await assert.rejects(() => redis({}, f.fetcher)(['GET','x']), /Penyimpanan/);
});
test('serialized refresh saves rotated token first, preserves cap and fails closed on lock/save/provider failure', async () => {
  const f = fixture(); await f.sessions.create(profile());
  const value = {...ownerConnection(tokens,{email:OWNER,userId:OWNER,sub:'owner-sub'}), expires_at:0};
  await f.store.write(value);
  let proceed, entered;
  const started = new Promise(r => { entered = r; }), wait = new Promise(r => { proceed = r; });
  const first = freshConnection(f.store, async () => { entered(); await wait; return {...tokens,access_token:'new',refresh_token:'rotated'}; });
  await started;
  await assert.rejects(() => freshConnection(f.store, async () => assert.fail()), /sedang diperbarui/);
  proceed(); const fresh = await first;
  assert.equal(fresh.exp, value.exp); assert.equal((await f.store.read()).refresh_token, 'rotated');
  assert.equal(fresh.access_token, 'new');
  await freshConnection(f.store, async () => assert.fail('fresh token must not refresh'));
  await f.store.write(value);
  await assert.rejects(() => freshConnection(f.store, async () => { throw new Error('invalid_grant secret'); }), /Sheets/);
  f.failSave = true;
  await assert.rejects(() => freshConnection(f.store, async () => ({...tokens,refresh_token:'lost'})), /Sheets/);
  f.failSave = false;
  assert.equal((await f.store.read()).refresh_token, tokens.refresh_token);
  await assert.rejects(() => freshConnection(f.store, async () => ({...tokens,refresh_token_expires_in:0})), /Sheets/);
  assert.equal(f.data.has('agen:v2:connection:sheets:lock'), false);
  await assert.rejects(() => freshConnection(f.store, async () => {
    f.data.set('agen:v2:connection:sheets:lock','replacement-lock');
    return {...tokens,refresh_token:'must-not-save'};
  }));
  assert.equal((await f.store.read()).refresh_token,tokens.refresh_token);
  assert.equal(f.data.get('agen:v2:connection:sheets:lock'),'replacement-lock');
});

const jarData = new Map();
const jar = {get:name => jarData.has(name) ? {value:jarData.get(name)} : undefined, set:(name,value) => jarData.set(name,value), delete:name => jarData.delete(name)};
globalThis.__j1Cookies = jar;
registerHooks({resolve(specifier, context, next) {
  if (specifier === 'next/headers') return {url:'data:text/javascript,export async function cookies(){return globalThis.__j1Cookies}', shortCircuit:true};
  return next(specifier, context);
}});
test('local route gates: independent Sheets, identity-only login, one-use callback and Origin, no legacy or secret leak', async () => {
  const previous = {...process.env}, previousFetch = globalThis.fetch;
  const f = fixture(), network = [];
  for (const key of ['KV_REST_API_URL','KV_REST_API_TOKEN','KV_REST_API_READ_ONLY_TOKEN','MAIL_WORKER_URL','MAIL_WORKER_TOKEN','TEAM_EMAILS']) delete process.env[key];
  Object.assign(process.env, env);
  globalThis.fetch = async (url, options) => {
    network.push(String(url));
    if (url === env.UPSTASH_REDIS_REST_URL) return f.fetcher(url, options);
    if (String(url).startsWith('https://sheets.googleapis.com/')) {
      assert.equal(options.headers.Authorization, 'Bearer test-access');
      if (String(url).includes('batchGet')) return Response.json({valueRanges:[{values:[['Email','Nama','Status'],['demo@mdprana.site','Demo','']]}]});
      return Response.json({sheets:[{properties:{title:'Synthetic'}}]});
    }
    if (url === 'https://oauth2.googleapis.com/token') return Response.json(tokens);
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json(profile());
    assert.fail(`Unexpected external request ${url}`);
  };
  try {
    const auth = await import('./auth.js'), google = await import('./google.js');
    const sessionRoute = await import('../app/api/session/route.js');
    const agents = await import('../app/api/agents/route.js');
    const status = await import('../app/api/status/route.js');
    const connect = await import('../app/api/auth/connect/route.js');
    const logout = await import('../app/api/auth/logout/route.js');
    const callback = await import('../app/api/auth/callback/route.js');
    jarData.clear();
    jarData.set('agen_session', seal({kind:'identity',...profile(),...tokens,exp:Date.now()+100000}, env.SESSION_SECRET));
    assert.equal((await agents.GET()).status,401);
    assert.equal((await sessionRoute.GET()).status,200);
    assert.equal((await (await sessionRoute.GET()).json()).email,null);
    const req = (path, origin = env.APP_URL, body = '{}') => new Request(env.APP_URL+path, {method:'POST', headers:{...(origin ? {Origin:origin} : {}),'Content-Type':'application/json'}, body});
    for (const origin of [null,'https://evil.example']) {
      assert.equal((await connect.POST(req('/api/auth/connect',origin))).status,403);
      assert.equal((await logout.POST(req('/api/auth/logout',origin))).status,403);
      assert.equal((await status.POST(req('/api/status',origin))).status,403);
    }
    assert.equal((await connect.POST(req('/api/auth/connect'))).status,401);
    const login = await google.startOAuth('login');
    const loginURL = new URL(login.headers.get('location'));
    assert.equal(loginURL.searchParams.get('scope'),'openid email');
    assert.equal(loginURL.searchParams.get('code_challenge_method'),'S256');
    const state = unseal(jarData.get('agen_oauth_v2'),env.SESSION_SECRET);
    await google.consumeState(state);
    await assert.rejects(() => google.consumeState(state));
    const memberId = await f.sessions.create(profile(TEAM[0],'member-sub'));
    jarData.set(auth.SESSION_COOKIE,memberId);
    assert.equal((await connect.POST(req('/api/auth/connect'))).status,403);
    const ownerId = await f.sessions.create(profile());
    jarData.set(auth.SESSION_COOKIE,ownerId);
    await f.store.write(ownerConnection(tokens,{email:OWNER,userId:OWNER,sub:'owner-sub'}));
    const result = await agents.GET(); assert.equal(result.status,200);
    assert.equal((await result.json()).agents[0].email,'demo@mdprana.site');
    const readiness = await (await sessionRoute.GET()).json();
    assert.equal(readiness.sheetsReady,true); assert.equal(readiness.mailReady,false); assert.equal(readiness.passwordEnabled,false);
    assert.equal(JSON.stringify(readiness).includes('test-access'),false);
    delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
    assert.equal((await auth.requireIdentity()).email,OWNER);
    Object.assign(process.env,env);
    const started = await connect.POST(req('/api/auth/connect'));
    assert.equal(started.status,200); assert.equal(started.headers.get('cache-control'),'no-store'); assert.equal(started.headers.get('location'),null);
    const startURL = new URL((await started.json()).authorizeUrl);
    assert.equal(startURL.origin+startURL.pathname,'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(startURL.searchParams.get('code_challenge_method'),'S256');
    const sealed = jarData.get('agen_oauth_v2'), oauthState = unseal(sealed,env.SESSION_SECRET);
    assert.equal(startURL.searchParams.get('state'),oauthState.state);
    const cbRequest = new Request(env.APP_URL+'/api/auth/callback?'+new URLSearchParams({state:oauthState.state,code:'synthetic'}));
    const cb = await callback.GET(cbRequest); assert.equal(cb.headers.get('location'),env.APP_URL+'/');
    jarData.set('agen_oauth_v2',sealed);
    const before = network.filter(u => u === 'https://oauth2.googleapis.com/token').length;
    assert.match((await callback.GET(cbRequest)).headers.get('location'), /connect_failed/);
    assert.equal(network.filter(u => u === 'https://oauth2.googleapis.com/token').length,before);
    f.down = true;
    assert.equal((await agents.GET()).status,503);
    const failed = await (await sessionRoute.GET()).json(); assert.equal(failed.email,null); assert.equal(failed.sheetsReady,false);
    f.down = false;
    const storedConnection = f.data.get('agen:v2:connection:sheets');
    await f.sessions.revokeAll(OWNER);
    assert.equal((await agents.GET()).status,401);
    assert.equal((await status.POST(req('/api/status'))).status,401);
    assert.equal((await connect.POST(req('/api/auth/connect'))).status,401);
    assert.equal((await (await sessionRoute.GET()).json()).email,null);
    const newOwnerId = await f.sessions.create(profile());
    jarData.set(auth.SESSION_COOKIE,newOwnerId);
    await google.startOAuth('connect');
    const changedState = unseal(jarData.get('agen_oauth_v2'),env.SESSION_SECRET);
    jarData.set(auth.SESSION_COOKIE,memberId);
    const changedCallback = await callback.GET(new Request(env.APP_URL+'/api/auth/callback?'+new URLSearchParams({state:changedState.state,code:'synthetic'})));
    assert.match(changedCallback.headers.get('location'),/connect_failed/);
    jarData.set(auth.SESSION_COOKIE,newOwnerId);
    assert.equal((await connect.POST(new Request(env.APP_URL+'/api/auth/connect',{method:'POST',headers:{Origin:env.APP_URL,'Content-Type':'text/plain'},body:'{}'}))).status,415);
    await assert.rejects(() => auth.jsonBody(req('/api/status',env.APP_URL,'x'.repeat(4097))));
    await assert.rejects(() => auth.jsonBody(req('/api/status',env.APP_URL,'[]')));
    assert.equal((await logout.POST(req('/api/auth/logout'))).status,200);
    await assert.rejects(() => f.sessions.read(newOwnerId));
    await assert.rejects(() => f.sessions.read(ownerId));
    assert.equal(f.data.get('agen:v2:connection:sheets'),storedConnection);
    assert.equal(jarData.has(auth.SESSION_COOKIE),false);
    assert.equal(network.some(u => /gmail.googleapis.com/.test(u)),false);
    assert.equal(f.calls.some(a => a[1]?.startsWith('agen:google:')),false);
  } finally {
    globalThis.fetch = previousFetch; jarData.clear(); delete globalThis.__j1Cookies;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env,previous);
  }
});
