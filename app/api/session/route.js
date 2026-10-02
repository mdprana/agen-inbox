import { config, readSession } from '../../../lib/google.js';
import { OWNER } from '../../../lib/helpers.js';
export async function GET() {
  const missing = config();
  const session = missing.length ? null : await readSession();
  return Response.json({configured:!missing.length, missing, email:session?.email === OWNER ? OWNER : null}, {headers:{'Cache-Control':'no-store'}});
}
