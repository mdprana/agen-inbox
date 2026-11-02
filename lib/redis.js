import { randomBytes, createHash } from 'node:crypto';
export const digest = value => createHash('sha256').update(value).digest('hex');
export function storageConfig(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const missing = [];
  try { const u = new URL(url); if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error(); } catch { missing.push('UPSTASH_REDIS_REST_URL'); }
  if (!(env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN)) missing.push('UPSTASH_REDIS_REST_TOKEN');
  return missing;
}
export function redis(env = process.env, fetcher = fetch) {
  return async args => {
    if (storageConfig(env).length) throw Object.assign(new Error('Penyimpanan belum siap.'), {status:503});
    try {
      const r = await fetcher((env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL).replace(/\/$/, ''), {method:'POST', headers:{Authorization:`Bearer ${env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN}`, 'Content-Type':'application/json'}, body:JSON.stringify(args), cache:'no-store', signal:AbortSignal.timeout(20000)});
      const data = await r.json();
      if (!r.ok || data.error) throw new Error();
      return data.result;
    } catch { throw Object.assign(new Error('Penyimpanan tidak dapat diakses.'), {status:503}); }
  };
}
export const PASSWORD_LIMIT = `
local now=redis.call('TIME'); local ms=now[1]*1000+math.floor(now[2]/1000)
for i=1,2 do redis.call('ZREMRANGEBYSCORE',KEYS[i],'-inf',ms-900000) end
if redis.call('ZCARD',KEYS[1])>=5 or redis.call('ZCARD',KEYS[2])>=20 then return 0 end
for i=1,2 do redis.call('ZADD',KEYS[i],ms,ARGV[1]); redis.call('PEXPIRE',KEYS[i],900000) end
return 1`;
export const PASSWORD_ADMIT = `
local now=redis.call('TIME'); local ms=now[1]*1000+math.floor(now[2]/1000)
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ms)
if redis.call('ZCARD',KEYS[1])>=1 then return 0 end
redis.call('ZADD',KEYS[1],ms+600000,ARGV[1]); redis.call('PEXPIRE',KEYS[1],600000); return 1`;
export const PASSWORD_UPDATE = `
if (redis.call('GET',KEYS[1]) or '')~=ARGV[1] then return 0 end
if ARGV[3]~='' then
 if redis.call('GET',KEYS[2])~=ARGV[3] then return 0 end
 local t=cjson.decode(ARGV[3]); local now=redis.call('TIME'); if t.exp<=now[1]*1000+math.floor(now[2]/1000) then return 0 end
end
redis.call('SET',KEYS[1],ARGV[2]); if ARGV[3]~='' then redis.call('DEL',KEYS[2]) end; return 1`;
export async function lock(command, key) {
  const nonce = randomBytes(32).toString('base64url');
  if (await command(['SET', key, nonce, 'NX', 'PX', '60000']) !== 'OK') throw Object.assign(new Error('Koneksi sedang diperbarui. Coba lagi.'), {status:503});
  const release = async () => {
    if (await command(['EVAL', "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", '1', key, nonce]) !== 1) throw Object.assign(new Error('Kunci koneksi kedaluwarsa.'), {status:503});
  };
  release.nonce = nonce;
  return release;
}
