import { requireSession, inbox, errorResponse } from '../../../lib/google.js';
export async function GET(request) {
  try { const session = await requireSession(); return Response.json(await inbox(session, new URL(request.url).searchParams.get('email')), {headers:{'Cache-Control':'no-store'}}); } catch(e) { return errorResponse(e); }
}
