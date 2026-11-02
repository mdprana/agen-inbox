import { checkOrigin, logout } from '../../../../lib/auth.js';
import { errorResponse } from '../../../../lib/google.js';
export async function POST(request) {
  try { checkOrigin(request); await logout(); return Response.json({ok:true}, {headers:{'Cache-Control':'no-store'}}); }
  catch(e) { return errorResponse(e); }
}
