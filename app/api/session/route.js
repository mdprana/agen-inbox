import { config, requireSheets } from '../../../lib/google.js';
import { requireIdentity } from '../../../lib/auth.js';
import { OWNER } from '../../../lib/helpers.js';
import { storageConfig } from '../../../lib/redis.js';
import { requireOutlook } from '../../../lib/outlook.js';
import { passwordEnabled } from '../../../lib/password-auth.js';
export async function GET() {
  const missing = config();
  let identity = null, sheetsReady = false, sheetsError = '', outlookReady = false, outlookError = '';
  try { identity = await requireIdentity(); } catch {}
  if (identity) {
    try { await requireSheets(); sheetsReady = true; }
    catch { sheetsError = 'Koneksi Sheets belum siap. Pemilik harus memeriksa konfigurasi atau hubungkan ulang.'; }
    try { await requireOutlook(); outlookReady = true; }
    catch { outlookError = 'Koneksi Outlook belum siap. Pemilik harus memeriksa konfigurasi atau hubungkan ulang Outlook.'; }
  }
  return Response.json({configured:!missing.length, missing, email:identity?.email || null, owner:identity?.email === OWNER, sheetsReady, outlookReady, sheets:{ready:sheetsReady, state:sheetsReady ? 'ready' : 'setup_or_reconnect', error:sheetsError}, outlook:{ready:outlookReady, state:outlookReady ? 'ready' : 'setup_or_reconnect', error:outlookError, coverage:'Inbox + Junk'}, passwordEnabled:passwordEnabled(), sharedReady:sheetsReady, storageConfigured:!storageConfig().length, connectionError:sheetsError}, {headers:{'Cache-Control':'no-store'}});
}
