import { config, readSession, requireSession } from '../../../lib/google.js';
import { OWNER } from '../../../lib/helpers.js';
import { identitySession, storageConfig } from '../../../lib/team-auth.js';
export async function GET() {
  const missing = config();
  let identity = null, ready = false, connectionError = '';
  if (!missing.length) {
    const raw = await readSession();
    try { identity = identitySession(raw); } catch {}
    // requireSession migrates only previously sealed verified-owner legacy cookies.
    if (identity || (raw && !raw.kind && raw.email === OWNER)) {
      try { const session = await requireSession(); identity = identitySession(session); ready = true; }
      catch(e) { connectionError = e.message; }
    }
  }
  return Response.json({configured:!missing.length, missing, email:identity?.email || null, owner:identity?.email === OWNER, sharedReady:ready, storageConfigured:!storageConfig().length, connectionError}, {headers:{'Cache-Control':'no-store'}});
}
