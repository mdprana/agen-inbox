import { config, requireSheets } from '../../../lib/google.js';
import { requireIdentity } from '../../../lib/auth.js';
import { OWNER } from '../../../lib/helpers.js';
import { storageConfig } from '../../../lib/redis.js';
import { mailConfig } from '../../../lib/mailstore.js';
import { passwordEnabled } from '../../../lib/password-auth.js';
export async function GET() {
  const missing = config();
  let identity = null, sheetsReady = false, sheetsError = '', mailReady = false, mailError = '';
  try { identity = await requireIdentity(); } catch {}
  if (identity) {
    try { await requireSheets(); sheetsReady = true; }
    catch { sheetsError = 'Koneksi Sheets belum siap. Pemilik harus memeriksa konfigurasi atau hubungkan ulang.'; }
    mailReady = !mailConfig().length;
    if (!mailReady) mailError = 'Sumber email Cloudflare belum dikonfigurasi. Pemilik harus mengisi MAIL_WORKER_URL dan MAIL_WORKER_TOKEN.';
  }
  return Response.json({configured:!missing.length, missing, email:identity?.email || null, owner:identity?.email === OWNER, sheetsReady, mailReady, sheets:{ready:sheetsReady, state:sheetsReady ? 'ready' : 'setup_or_reconnect', error:sheetsError}, mail:{ready:mailReady, state:mailReady ? 'ready' : 'setup', error:mailError, coverage:'Cloudflare'}, passwordEnabled:passwordEnabled(), sharedReady:sheetsReady, storageConfigured:!storageConfig().length, connectionError:sheetsError}, {headers:{'Cache-Control':'no-store'}});
}
