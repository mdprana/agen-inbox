import { requireSession, readAgents, errorResponse } from '../../../lib/google.js';
export async function GET() {
  try {
    const rows = await readAgents(await requireSession());
    const counts = new Map(); rows.forEach(r => counts.set(r.email, (counts.get(r.email)||0)+1));
    return Response.json({agents:rows.map(r => ({email:r.email, name:r.name, status:r.status, sheet:r.sheet, writable:r.statusColumn >= 0 && counts.get(r.email) === 1, duplicate:counts.get(r.email)>1}))}, {headers:{'Cache-Control':'no-store'}});
  } catch(e) { return errorResponse(e); }
}
