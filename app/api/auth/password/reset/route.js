import { checkOrigin, jsonBody, requireIdentity } from '../../../../../lib/auth.js';
import { passwordStore, requirePassword, trustedIP } from '../../../../../lib/password-auth.js';
import { errorResponse } from '../../../../../lib/google.js';
export async function POST(request) {
  try {
    checkOrigin(request); const body = await jsonBody(request); requirePassword();
    const store = passwordStore(), ip = trustedIP(request);
    if (body.action === 'issue') {
      let identity = null;
      try { identity = await requireIdentity(); } catch (e) { if (e.status !== 401) throw e; }
      const token = await store.issue(identity, body.email, 'reset', ip);
      return Response.json(token ? {ok:true, token} : {ok:true}, {headers:{'Cache-Control':'no-store'}});
    }
    if (body.action !== 'consume') throw new Error('Invalid action');
    await store.consume(body.email, body.token, 'reset', body.password, ip);
    return Response.json({ok:true}, {headers:{'Cache-Control':'no-store'}});
  } catch(e) { return errorResponse(e); }
}
