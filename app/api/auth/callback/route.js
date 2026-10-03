import { cookies } from 'next/headers';
import { OWNER, unseal } from '../../../../lib/helpers.js';
import { base, config, tokenRequest, setSession, readSession, google } from '../../../../lib/google.js';
import { verifiedIdentity, identitySession, validateState, ownerConnection, connectionStore } from '../../../../lib/team-auth.js';
export async function GET(request) {
  const jar = await cookies();
  const state = unseal(jar.get('agen_oauth')?.value, process.env.SESSION_SECRET);
  jar.delete('agen_oauth');
  if (config().length) return Response.json({error:'Konfigurasi OAuth belum siap.'},{status:503});
  try {
    const params = new URL(request.url).searchParams;
    const current = state?.mode === 'connect' ? identitySession(await readSession()) : null;
    const mode = validateState(state, params, current);
    const tokens = await tokenRequest({grant_type:'authorization_code', code:params.get('code'), redirect_uri:base()+'/api/auth/callback', code_verifier:state.verifier});
    const identity = verifiedIdentity(await google(tokens, 'https://openidconnect.googleapis.com/v1/userinfo'));
    if (mode === 'connect') {
      if (identity.email !== OWNER || identity.sub !== current.sub) throw new Error('Account forbidden');
      await connectionStore().write(ownerConnection(tokens));
    } else { await setSession(identity); }
    return Response.redirect(base()+'/');
  } catch {
    if (state?.mode !== 'connect') jar.delete('agen_session');
    return Response.redirect(base()+'/?auth='+ (state?.mode === 'connect' ? 'connect_failed' : 'failed'));
  }
}
