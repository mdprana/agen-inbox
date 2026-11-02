import { cookies } from 'next/headers';
import { OWNER, unseal } from '../../../../lib/helpers.js';
import { config, tokenRequest, google, consumeState } from '../../../../lib/google.js';
import { base, setSession, requireIdentity } from '../../../../lib/auth.js';
import { verifiedIdentity, validateState, ownerConnection, connectionStore, sessionStore } from '../../../../lib/team-auth.js';
export async function GET(request) {
  const jar = await cookies();
  const state = unseal(jar.get('agen_oauth_v2')?.value, process.env.SESSION_SECRET);
  jar.delete('agen_oauth_v2');
  jar.delete('agen_oauth');
  if (config().length) return Response.json({error:'Konfigurasi OAuth belum siap.'}, {status:503});
  try {
    const params = new URL(request.url).searchParams;
    const current = jar.get('agen_session_v2')?.value ? await requireIdentity() : null;
    const mode = validateState(state, params, current);
    await consumeState(state);
    const tokens = await tokenRequest({grant_type:'authorization_code', code:params.get('code'), redirect_uri:base()+'/api/auth/callback', code_verifier:state.verifier});
    const profile = await google(tokens, 'https://openidconnect.googleapis.com/v1/userinfo');
    const identity = verifiedIdentity(profile);
    if (mode === 'connect') {
      if (identity.email !== OWNER) throw new Error('Account forbidden');
      await sessionStore().ownerBinding(current, identity.sub);
      const store = connectionStore(), release = await store.lock();
      try { await store.write(ownerConnection(tokens, {...identity, userId:current.userId}), release.nonce); }
      finally { await release(); }
    } else { await setSession(profile); }
    return Response.redirect(base()+'/');
  } catch {
    return Response.redirect(base()+'/?auth='+ (state?.mode === 'connect' ? 'connect_failed' : 'failed'));
  }
}
