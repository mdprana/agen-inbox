import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { redis, digest } from '../lib/redis.js';
import { allowedEmail } from '../lib/team-auth.js';
import { passwordStore } from '../lib/password-auth.js';
const fail = message => Object.assign(new Error(message), {usage:true});
export async function invite(address, purpose = 'invite', env = process.env, fetcher = fetch) {
  address = typeof address === 'string' ? address.trim().toLowerCase() : '';
  if (!allowedEmail(address)) throw fail('Email tidak ada di daftar tim.');
  if (!['invite','reset'].includes(purpose)) throw fail('Tujuan harus invite atau reset.');
  if (!env.APP_URL) throw fail('APP_URL belum diatur.');
  const user = await passwordStore(env, fetcher).user(address);
  if (purpose === 'invite' && user?.password) throw fail('Akun sudah punya kata sandi; gunakan reset.');
  if (purpose === 'reset' && !user?.password) throw fail('Akun belum punya kata sandi; gunakan invite.');
  const token = randomBytes(32).toString('base64url');
  const value = {schema:1, purpose, userId:address, authVersion:user?.authVersion || 0, exp:Date.now()+1800000};
  if (await redis(env, fetcher)(['SET', 'agen:v2:password:token:'+digest(token), JSON.stringify(value), 'NX', 'PX', '1800000']) !== 'OK') throw fail('Token gagal disimpan.');
  return `${env.APP_URL}/#${purpose}=${token}`;
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try { console.log(await invite(process.argv[2], process.argv[3] || 'invite')); }
  catch (e) { console.error(e.usage || e.status ? e.message : 'Gagal menerbitkan tautan.'); console.error('Pemakaian: node --env-file=<path> scripts/password-invite.mjs <email> [invite|reset]'); process.exit(1); }
}
