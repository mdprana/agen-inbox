import { checkOrigin, jsonBody, requireIdentity } from '../../../../../lib/auth.js';
import { passwordStore, requirePassword, trustedIP } from '../../../../../lib/password-auth.js';
import { errorResponse } from '../../../../../lib/google.js';
export async function POST(request) {
  try {
    checkOrigin(request); const body = await jsonBody(request); requirePassword();
    const store = passwordStore(), ip = trustedIP(request);
    if (body.action === 'google') await store.enroll(await requireIdentity(), body.password, ip);
    else if (body.action === 'invite') await store.consume(body.email, body.token, 'invite', body.password, ip);
    else throw new Error('Invalid action');
    return Response.json({ok:true}, {headers:{'Cache-Control':'no-store'}});
  } catch(e) { return errorResponse(e); }
}
