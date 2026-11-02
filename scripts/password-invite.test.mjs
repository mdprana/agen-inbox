import test from 'node:test';
import assert from 'node:assert/strict';
import { invite } from './password-invite.mjs';
import { passwordStore } from '../lib/password-auth.js';
import { PASSWORD_UPDATE } from '../lib/redis.js';
import { TEAM } from '../lib/team-auth.js';
import { OWNER } from '../lib/helpers.js';
const env = {APP_URL:'http://localhost:3109', PASSWORD_LOGIN_ENABLED:'true', UPSTASH_REDIS_REST_URL:'https://redis.example', UPSTASH_REDIS_REST_TOKEN:'synthetic-only'};
test('invite script writes a token record accepted by consume(); state checks exit cleanly', async () => {
  const data = new Map();
  const fetcher = async (url, options) => {
    const a = JSON.parse(options.body); let result;
    if (a[0] === 'GET') result = data.get(a[1]) ?? null;
    else if (a[0] === 'SET') { assert.deepEqual(a.slice(3), ['NX','PX','1800000']); result = data.has(a[1]) ? null : (data.set(a[1],a[2]), 'OK'); }
    else if (a[0] === 'EVAL' && a[1] === PASSWORD_UPDATE) { const [uk,tk,old,next,traw] = a.slice(3); result = (data.get(uk) || '') === old && data.get(tk) === traw ? (data.set(uk,next), data.delete(tk), 1) : 0; }
    else result = 1;
    return Response.json({result});
  };
  const member = TEAM[0], store = passwordStore(env, fetcher);
  await assert.rejects(() => invite('outsider@gmail.com', 'invite', env, fetcher), /daftar tim/);
  await assert.rejects(() => invite(member, 'reset', env, fetcher), /gunakan invite/);
  const link = await invite(member, 'invite', env, fetcher), [, purpose, token] = /^http:\/\/localhost:3109\/#(invite)=([A-Za-z0-9_-]{43})$/.exec(link);
  await store.consume(member, token, purpose, 'fifteen chars ok!', '192.0.2.1');
  assert.equal((await store.user(member)).authVersion, 2);
  await assert.rejects(() => invite(member, 'invite', env, fetcher), /gunakan reset/);
  const reset = /#reset=(.+)$/.exec(await invite(member, 'reset', env, fetcher))[1];
  await store.consume(member, reset, 'reset', 'another fifteen chars', '192.0.2.1');
  assert.equal((await store.user(member)).authVersion, 3);
  assert.match(await invite(OWNER, 'invite', env, fetcher), /#invite=/);
});
