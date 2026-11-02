import { startOutlook } from '../../../../../lib/outlook.js';
import { checkOrigin, jsonBody, authorizeResponse } from '../../../../../lib/auth.js';
import { errorResponse } from '../../../../../lib/google.js';
export async function POST(request) {
  try { checkOrigin(request); await jsonBody(request); return authorizeResponse(await startOutlook(), 'Outlook'); }
  catch(e) { return errorResponse(e); }
}
