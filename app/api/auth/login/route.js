import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { config, base, cookieOptions, SCOPES } from '../../../../lib/google.js';
import { seal, OWNER } from '../../../../lib/helpers.js';
export async function GET() {
  if (config().length) return Response.json({error:'Konfigurasi OAuth belum siap.'}, {status:503, headers:{'Cache-Control':'no-store'}});
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  (await cookies()).set('agen_oauth', seal({state, verifier, exp:Date.now()+600000}, process.env.SESSION_SECRET), cookieOptions(600));
  const params = new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID, redirect_uri:base()+'/api/auth/callback', response_type:'code', scope:SCOPES.join(' '), state, code_challenge:createHash('sha256').update(verifier).digest('base64url'), code_challenge_method:'S256', access_type:'offline', prompt:'consent', login_hint:OWNER});
  return Response.redirect('https://accounts.google.com/o/oauth2/v2/auth?'+params);
}
