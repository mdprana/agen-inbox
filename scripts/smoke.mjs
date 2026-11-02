import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { realpathSync } from 'node:fs';
import assert from 'node:assert/strict';
import { seal } from '../lib/helpers.js';
const configured = process.argv.includes('--configured');
const port = configured ? 3109 : 3108;
const origin = `http://localhost:${port}`;
const env = Object.fromEntries(['PATH','HOME','TMPDIR','LANG','TZ'].filter(k => process.env[k]).map(k => [k,process.env[k]]));
Object.assign(env, {NODE_ENV:'production', NEXT_TELEMETRY_DISABLED:'1', UPSTASH_REDIS_REST_URL:'', UPSTASH_REDIS_REST_TOKEN:'', KV_REST_API_URL:'', KV_REST_API_TOKEN:'', KV_REST_API_READ_ONLY_TOKEN:'', KV_URL:'', REDIS_URL:'', MAIL_WORKER_URL:configured?'https://mail.example.invalid':'', MAIL_WORKER_TOKEN:configured?'w'.repeat(32):'', PASSWORD_LOGIN_ENABLED:'false', TEAM_EMAILS:'', SPREADSHEET_ID:'synthetic-only', GOOGLE_CLIENT_ID:configured?'test-client':'', GOOGLE_CLIENT_SECRET:configured?'test-secret':'', SESSION_SECRET:configured?'s'.repeat(32):'', APP_URL:configured?origin:''});
await new Promise((resolve,reject) => {
  const server = createServer();
  server.once('error',reject);
  server.listen(port, () => server.close(resolve));
});
const child = spawn(process.execPath,['node_modules/next/dist/bin/next','start','--port',String(port)],{cwd:process.cwd(),env,stdio:'ignore'});
try {
  let ready = false;
  for (let i=0;i<80;i++) {
    if (child.exitCode !== null) break;
    try { ready = (await fetch(origin+'/api/session')).ok; if (ready) break; } catch {}
    await new Promise(r => setTimeout(r,100));
  }
  assert.ok(ready,'Own server ready');
  for (const [path,status,method] of [['/',200,'GET'],['/api/session',200,'GET'],['/api/agents',401,'GET'],['/api/inbox?email=demo@mdprana.site',401,'GET'],['/api/status',403,'POST'],['/api/auth/connect',405,'GET'],['/api/auth/outlook/connect',404,'GET'],['/api/auth/outlook/callback',404,'GET']]) {
    const r = await fetch(origin+path,{method}); assert.equal(r.status,status); assert.equal(r.headers.get('x-content-type-options'),'nosniff'); console.log(method,path,r.status);
  }
  const session = await (await fetch(origin+'/api/session')).json();
  assert.equal(session.configured,configured); assert.equal(session.email,null); assert.equal(session.sheetsReady,false); assert.equal(session.mailReady,false); assert.equal('outlookReady' in session,false); assert.equal(session.passwordEnabled,false);
  assert.equal((await fetch(origin+'/api/auth/login',{redirect:'manual'})).status,503);
  for (const Origin of [null,'https://evil.example']) {
    for (const path of ['/api/auth/logout','/api/auth/connect','/api/status','/api/auth/password','/api/auth/password/enroll','/api/auth/password/invite','/api/auth/password/reset']) {
      const r = await fetch(origin+path,{method:'POST',headers:{...(Origin ? {Origin} : {}),'Content-Type':'application/json'},body:'{}',redirect:'manual'});
      assert.equal(r.status,403);
    }
  }
  if (configured) {
    for (const address of ['jderchild@gmail.com','1nd0n3s1aemas@gmail.com','madepranajaya01@gmail.com']) {
      const Cookie = 'agen_session='+seal({kind:'identity',email:address,email_verified:true,sub:'synthetic',exp:Date.now()+100000},env.SESSION_SECRET);
      assert.equal((await fetch(origin+'/api/agents',{headers:{Cookie}})).status,401);
      assert.equal((await (await fetch(origin+'/api/session',{headers:{Cookie}})).json()).email,null);
    }
    for (const path of ['/api/auth/password','/api/auth/password/enroll','/api/auth/password/invite','/api/auth/password/reset']) {
      assert.equal((await fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,503);
    }
    for (const path of ['/api/auth/connect']) assert.equal((await fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}',redirect:'manual'})).status,401);
    assert.match((await fetch(origin+'/api/auth/callback?state=bad&code=bad',{redirect:'manual'})).headers.get('location'),/auth=failed/);
    assert.equal((await fetch(origin+'/api/auth/logout',{method:'POST',headers:{Origin:origin}})).status,200);
  }
   const html=await (await fetch(origin)).text();
   assert.doesNotMatch(html,/test-secret|ssssssssssssssssssssssssssssssss|wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww/);
   console.log('J5 production guards passed; authenticated member/readiness/provider success paths remain native stub proof only.');
} finally {
   if (child.exitCode === null) {
     assert.equal(realpathSync(`/proc/${child.pid}/cwd`),realpathSync(process.cwd()),'Verify own child cwd before stop');
     child.kill('SIGTERM');
   }
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit',resolve); });
}
