import { cookies } from 'next/headers';
import { checkOrigin, errorResponse } from '../../../../lib/google.js';
export async function POST(request) {
  try { checkOrigin(request); (await cookies()).delete('agen_session'); return Response.json({ok:true}, {headers:{'Cache-Control':'no-store'}}); } catch(e) { return errorResponse(e); }
}
