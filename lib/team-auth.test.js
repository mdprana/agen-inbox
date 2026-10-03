import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER, seal, unseal } from './helpers.js';
import { verifiedIdentity, identitySession, ownerConnect, validateState, connectionStore, ownerConnection, freshConnection, migrateLegacy, DATA_SCOPES } from './team-auth.js';
const env = {SESSION_SECRET:'s'.repeat(32), UPSTASH_REDIS_REST_URL:'https://redis.example', UPSTASH_REDIS_REST_TOKEN:'test-only'};
const member = verifiedIdentity({email:'jderchild@gmail.com', email_verified:true, sub:'member'});
const owner = verifiedIdentity({email:OWNER, email_verified:true, sub:'owner'});
const tokens = {access_token:'test-access', refresh_token:'test-refresh', expires_in:3600, scope:DATA_SCOPES.join(' ')};
test('Vercel KV aliases use writable token and encrypted storage', async () => {
  const kv = {SESSION_SECRET:env.SESSION_SECRET, KV_REST_API_URL:'https://redis.example', KV_REST_API_TOKEN:'write-test', KV_REST_API_READ_ONLY_TOKEN:'read-test'};
  let stored;
  const store = connectionStore(kv, async (url, options) => {
    assert.equal(url,kv.KV_REST_API_URL);
    assert.equal(options.headers.Authorization,'Bearer write-test');
    const args=JSON.parse(options.body);
    if(args[0]==='SET') { stored=args[2]; return Response.json({result:'OK'}); }
    return Response.json({result:stored});
  });
  await store.write(ownerConnection(tokens));
  assert.equal((await store.read()).email,OWNER);
  assert.ok(!stored.includes('test-refresh'));
});
test('exact verified allowlist, revoke per request, identity strips tokens', () => {
  for (const email of ['outsider@gmail.com','JDERCHILD@gmail.com','jderchild+tag@gmail.com', 'jder.child@gmail.com']) assert.throws(()=>verifiedIdentity({email,email_verified:true,sub:'x'}));
  assert.throws(()=>verifiedIdentity({email:OWNER,email_verified:false,sub:'x'}));
  assert.throws(()=>identitySession(member, {TEAM_EMAILS:''}));
  assert.equal(identitySession({...member, ...tokens}).access_token, undefined);
  assert.equal(identitySession(owner,{TEAM_EMAILS:''}).email,OWNER);
});
test('owner-only connect and PKCE mode/sub/state binding', () => {
  assert.throws(()=>ownerConnect(member)); ownerConnect(owner);
  const state={mode:'connect', state:'nonce',verifier:'pkce',sub:owner.sub,exp:Date.now()+10000};
  const params=new URLSearchParams({state:'nonce',code:'test-code'});
  assert.equal(validateState(state,params,owner),'connect');
  assert.throws(()=>validateState(state,params,member));
  assert.throws(()=>validateState({...state,sub:'other'},params,owner));
  assert.throws(()=>validateState({...state,mode:'other'},params,owner));
  assert.throws(()=>validateState({...state,verifier:''},params,owner));
  assert.throws(()=>validateState(state,new URLSearchParams({state:'wrong',code:'test-code'}),owner));
});
test('Redis stores authenticated ciphertext only; absent/expired/member connection fail closed', async () => {
  let saved=null, last;
  const fetcher=async(url, options)=>{last=JSON.parse(options.body); if(last[0]==='SET') {saved=last[2]; assert.equal(last[3],'PX'); return Response.json({result:'OK'});} return Response.json({result:saved});};
  const store=connectionStore(env,fetcher);
  await assert.rejects(()=>store.read(),/Pemilik harus/);
  const value=ownerConnection(tokens); await store.write(value);
  assert.ok(!saved.includes(tokens.refresh_token)); assert.deepEqual(unseal(saved,env.SESSION_SECRET),value);
  assert.deepEqual(await store.read(),value);
  saved=seal({...value,exp:Date.now()-1},env.SESSION_SECRET); await assert.rejects(()=>store.read(),/Pemilik harus/);
  saved=seal({...value,email:member.email},env.SESSION_SECRET); await assert.rejects(()=>store.read(),/Pemilik harus/);
  saved=saved.slice(0,-5)+'xxxxx'; await assert.rejects(()=>store.read());
  await assert.rejects(()=>connectionStore({SESSION_SECRET:env.SESSION_SECRET},fetcher).read(),/Penyimpanan/);
  await assert.rejects(()=>connectionStore(env,async()=>{throw new Error('private detail');}).read(),/tidak dapat diakses/);
});
test('legacy migration rechecks verified owner, no member-token migration, preserves expiry', async () => {
  const legacy={email:OWNER,...tokens,expires_at:Date.now()+3600000,exp:Date.now()+100000};
  let saved;
  const store={read:async()=>{throw Object.assign(new Error('Koneksi Google pemilik belum siap'),{status:503});},write:async value=>{saved=value;}};
  const identity=await migrateLegacy(legacy,store,async()=>assert.fail(),async()=>({email:OWNER,email_verified:true,sub:'real-owner'}));
  assert.equal(identity.sub,'real-owner'); assert.equal(saved.exp,legacy.exp); assert.equal(identity.access_token,undefined);
  assert.equal(await migrateLegacy({...legacy,email:member.email},store,async()=>assert.fail(),async()=>assert.fail()),null);
  saved=null; await assert.rejects(()=>migrateLegacy(legacy,store,async()=>assert.fail(),async()=>member)); assert.equal(saved,null);
});
test('fresh owner token, refresh rotation and Testing expiry errors', async () => {
  let value={...ownerConnection(tokens),expires_at:0}, writes=0;
  const store={read:async()=>value,write:async v=>{value=v;writes++;}};
  const fresh=await freshConnection(store,async params=>{assert.equal(params.refresh_token,tokens.refresh_token); return {...tokens,access_token:'new-access',refresh_token:'new-refresh'};});
  assert.equal(fresh.access_token,'new-access');assert.equal(fresh.refresh_token,'new-refresh');assert.equal(writes,1);
  await freshConnection(store,async()=>assert.fail('fresh token must not refresh'));
  value.expires_at=0; await assert.rejects(()=>freshConnection(store,async()=>{throw new Error('invalid_grant');}),/Testing/);
  assert.throws(()=>ownerConnection({...tokens,scope:'openid email'}));
  assert.throws(()=>ownerConnection({...tokens,refresh_token_expires_in:0}));
});
