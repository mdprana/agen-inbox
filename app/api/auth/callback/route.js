import { cookies } from 'next/headers';
import { OWNER, unseal } from '../../../../lib/helpers.js';
import { base, config, tokenRequest, setSession, google, SCOPES } from '../../../../lib/google.js';
export async function GET(request) {
  const jar = await cookies();
  const state = unseal(jar.get('agen_oauth')?.value, process.env.SESSION_SECRET);
  jar.delete('agen_oauth');
  if (config().length) return Response.json({error:'Konfigurasi OAuth belum siap.'},{status:503});
  try {
    const params = new URL(request.url).searchParams;
    if (!state || !params.get('state') || params.get('state') !== state.state || !params.get('code') || params.has('error')) throw new Error('Invalid OAuth state');
    const tokens = await tokenRequest({grant_type:'authorization_code', code:params.get('code'), redirect_uri:base()+'/api/auth/callback', code_verifier:state.verifier});
    const identity = await google(tokens, 'https://openidconnect.googleapis.com/v1/userinfo');
    if (identity.email !== OWNER || identity.email_verified !== true || !identity.sub) throw new Error('Account forbidden');
    const granted = new Set((tokens.scope || '').split(' '));
    if (!SCOPES.filter(s => s.startsWith('https:')).every(s => granted.has(s))) throw new Error('Missing scopes');
    if (!tokens.refresh_token || !tokens.access_token || !Number.isFinite(tokens.expires_in)) throw new Error('Missing tokens');
    await setSession({email:OWNER, access_token:tokens.access_token, refresh_token:tokens.refresh_token, expires_at:Date.now()+tokens.expires_in*1000, exp:Date.now()+604800000});
    return Response.redirect(base()+'/');
  } catch {
    jar.delete('agen_session');
    return Response.redirect(base()+'/?auth=failed');
  }
}
