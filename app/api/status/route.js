import { requireSheets, writeStatus, errorResponse } from '../../../lib/google.js';
import { checkOrigin, jsonBody } from '../../../lib/auth.js';
export async function POST(request) {
  try {
    checkOrigin(request);
    const session = await requireSheets();
    const {email, status} = await jsonBody(request);
    if (typeof email !== 'string' || typeof status !== 'string') throw new Error('Email dan status wajib diisi.');
    return Response.json(await writeStatus(session, email, status), {headers:{'Cache-Control':'no-store'}});
  } catch(e) { return errorResponse(e); }
}
