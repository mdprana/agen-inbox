import { requireSheets, errorResponse } from '../../../lib/google.js';
import { checkOrigin, jsonBody } from '../../../lib/auth.js';
import { ownerConnect } from '../../../lib/team-auth.js';
import { DEFAULT_SHEET } from '../../../lib/helpers.js';
import { APPLY_BLOCKED, readSnapshot, migrationAttachment } from '../../../lib/alias-migration.js';

export async function POST(request) {
  try {
    checkOrigin(request);
    const body = await jsonBody(request, 256);
    const session = await requireSheets();
    ownerConnect(session);
    if (Object.keys(body).length !== 1 || !['plan','backup','confirm-backup','apply','report'].includes(body.action)) throw Object.assign(new Error('Action migrasi tidak valid.'), {status:400});
    if (body.action !== 'plan') throw Object.assign(new Error(body.action === 'apply' ? APPLY_BLOCKED : 'Tidak ada plan tersimpan. Simulasi dan backup hanya tersedia bersama dalam satu request read-only; unduh blob yang sama, bukan fetch ulang.'), {status:409});
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(process.env.SPREADSHEET_ID || DEFAULT_SHEET)}`;
    return migrationAttachment(await readSnapshot(session, url));
  } catch(e) { return errorResponse(e); }
}
