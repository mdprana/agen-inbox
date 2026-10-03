import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const configured = process.argv.includes('--configured');
const port = configured ? 3109 : 3108;
const origin = `http://localhost:${port}`;
const env = {...process.env, UPSTASH_REDIS_REST_URL:'', UPSTASH_REDIS_REST_TOKEN:'', TEAM_EMAILS:'jderchild@gmail.com', GOOGLE_CLIENT_ID:configured?'test-client':'', GOOGLE_CLIENT_SECRET:configured?'test-secret':'', SESSION_SECRET:configured?'s'.repeat(32):'', APP_URL:configured?origin:''};
const child = spawn(process.execPath,['node_modules/next/dist/bin/next','start','--port',String(port)],{env,stdio:'ignore'});
try {
  let ready=false;
  for(let i=0;i<80;i++) {try {ready=(await fetch(origin+'/api/session')).ok; if(ready)break;}catch{} await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,'Server ready');
  for(const [path,status,method] of [['/',200,'GET'],['/api/session',200,'GET'],['/api/agents',401,'GET'],['/api/inbox?email=1nd0n3s1aemas%2Btest@gmail.com',401,'GET'],['/api/status',401,'POST']]) {
    const r=await fetch(origin+path,{method}); assert.equal(r.status,status); assert.equal(r.headers.get('x-content-type-options'),'nosniff'); console.log(method,path,r.status);
  }
  const session=await (await fetch(origin+'/api/session')).json(); assert.equal(session.configured,configured); assert.equal(session.email,null);
  if(configured) {
    const login=await fetch(origin+'/api/auth/login',{redirect:'manual'}); assert.equal(login.status,302); assert.ok(login.headers.get('location').startsWith('https://accounts.google.com/')); assert.match(login.headers.get('set-cookie'),/HttpOnly/); console.log('OAuth redirect and HttpOnly state cookie passed (no Google request).');
    const authURL=new URL(login.headers.get('location')); assert.equal(authURL.searchParams.get('scope'),'openid email'); assert.equal(authURL.searchParams.get('access_type'),null); assert.equal(authURL.searchParams.get('code_challenge_method'),'S256');
    assert.equal((await fetch(origin+'/api/auth/connect',{redirect:'manual'})).status,401);
    const {seal}=await import('../lib/helpers.js');
    const identity={kind:'identity',email:'jderchild@gmail.com',email_verified:true,sub:'test-member',exp:Date.now()+100000};
    const Cookie='agen_session='+seal(identity,env.SESSION_SECRET);
    assert.equal((await fetch(origin+'/api/auth/connect',{headers:{Cookie},redirect:'manual'})).status,403);
    assert.equal((await fetch(origin+'/api/agents',{headers:{Cookie}})).status,503);
    const member=await (await fetch(origin+'/api/session',{headers:{Cookie}})).json(); assert.equal(member.email,identity.email); assert.equal(member.sharedReady,false); assert.equal(member.access_token,undefined);
    const ownerCookie='agen_session='+seal({...identity,email:'1nd0n3s1aemas@gmail.com'},env.SESSION_SECRET);
    assert.equal((await fetch(origin+'/api/auth/connect',{headers:{Cookie:ownerCookie},redirect:'manual'})).status,503);
    const forbidden='agen_session='+seal({...identity,email:'outsider@gmail.com'},env.SESSION_SECRET);
    assert.equal((await fetch(origin+'/api/agents',{headers:{Cookie:forbidden}})).status,401);
    console.log('Identity-only scope, member connect 403, missing storage 503, forbidden user 401 passed.');
    const foreign=await fetch(origin+'/api/auth/logout',{method:'POST',headers:{Origin:'https://evil.example'}});assert.equal(foreign.status,403);
    const missing=await fetch(origin+'/api/auth/logout',{method:'POST'});assert.equal(missing.status,403);
    const local=await fetch(origin+'/api/auth/logout',{method:'POST',headers:{Origin:origin}});assert.equal(local.status,200);console.log('Logout CSRF: foreign/missing 403, same-origin 200.');
  } else {assert.equal((await fetch(origin+'/api/auth/login')).status,503); console.log('Missing configuration fail-closed passed.');}
  console.log('Production smoke passed.');
} finally {child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});}
