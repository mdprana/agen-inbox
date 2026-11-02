import { checkOrigin, jsonBody, requireIdentity } from '../../../../../lib/auth.js';
import { passwordStore, requirePassword, trustedIP } from '../../../../../lib/password-auth.js';
import { errorResponse } from '../../../../../lib/google.js';
export async function POST(request) {
  try {
    checkOrigin(request); const body = await jsonBody(request); requirePassword();
    let identity = null;
    try { identity = await requireIdentity(); } catch (e) { if (e.status !== 401) throw e; }
    const token = await passwordStore().issue(identity, body.email, 'invite', trustedIP(request));
    return Response.json(token ? {ok:true, token} : {ok:true}, {headers:{'Cache-Control':'no-store'}});
  } catch(e) { return errorResponse(e); }
}
