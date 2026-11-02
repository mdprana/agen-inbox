import { startOAuth, errorResponse } from '../../../../lib/google.js';
import { checkOrigin, jsonBody, authorizeResponse } from '../../../../lib/auth.js';
export async function POST(request) {
  try { checkOrigin(request); await jsonBody(request); return authorizeResponse(await startOAuth('connect'), 'Sheets'); }
  catch(e) { return errorResponse(e); }
}
