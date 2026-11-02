import { checkOrigin, jsonBody, setSessionId } from '../../../../lib/auth.js';
import { passwordStore, requirePassword, trustedIP } from '../../../../lib/password-auth.js';
import { errorResponse } from '../../../../lib/google.js';
export async function POST(request) {
  try {
    checkOrigin(request); const body = await jsonBody(request); requirePassword();
    const id = await passwordStore().login(body.email, body.password, trustedIP(request));
    await setSessionId(id);
    return Response.json({ok:true}, {headers:{'Cache-Control':'no-store'}});
  } catch(e) { return errorResponse(e); }
}
