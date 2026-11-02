import { inbox } from '../../../lib/outlook.js';
import { errorResponse } from '../../../lib/google.js';
export async function GET(request) {
  try { return Response.json(await inbox(new URL(request.url).searchParams.get('email')), {headers:{'Cache-Control':'no-store'}}); } catch(e) { return errorResponse(e); }
}
