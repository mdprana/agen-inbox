import { createHash } from 'node:crypto';
import { inboxAlias } from './helpers.js';

export const APPLY_BLOCKED = 'Apply tidak tersedia: kapasitas penyimpanan provider dan batas keras runtime belum diverifikasi. Perlu verifikasi DEV, penyimpanan privat terikat sesi, acknowledgement backup, freeze, journal dan final verify sebelum write dapat dibangun.';
export const SNAPSHOT_LIMIT = 8 * 1024 * 1024;
export const checksum = value => createHash('sha256').update(value).digest('hex');
const fail = () => { throw Object.assign(new Error('Snapshot lengkap tidak dapat diverifikasi atau melebihi batas read-only.'), {status:503}); };
const literal = cell => typeof cell?.userEnteredValue?.stringValue === 'string' ? cell.userEnteredValue.stringValue : null;
const emptyValue = value => value === undefined || (Object.keys(value).length === 1 && value.stringValue === '');
export const blankStatus = cell => emptyValue(cell?.userEnteredValue) && emptyValue(cell?.effectiveValue);
const header = value => (value || '').trim().toLowerCase().replace(/[_-]/g,' ').replace(/\s+/g,' ');
const statusHeaders = ['status','status verifikasi','verification status'];
const nameHeaders = ['agent name','nama agen','nama agent','nama','agent','agen'];
const hash = value => checksum(JSON.stringify(value));
const intersects = (range, sheetId, row, col) => (range.sheetId === undefined || range.sheetId === sheetId) && row >= (range.startRowIndex || 0) && row < (range.endRowIndex ?? Infinity) && col >= (range.startColumnIndex || 0) && col < (range.endColumnIndex ?? Infinity);

export function planMigration(snapshot) {
  if (!snapshot?.spreadsheetId || !snapshot.properties || !Array.isArray(snapshot.sheets)) fail();
  const index = new Map(), candidates = [], reports = [], ids = new Set();
  let dimensions = 0;
  for (const sheet of snapshot.sheets) {
    const p = sheet.properties, grid = p?.gridProperties;
    if (!Number.isInteger(p?.sheetId) || ids.has(p.sheetId) || p.sheetType !== 'GRID' || !Number.isSafeInteger(grid?.rowCount) || !Number.isSafeInteger(grid?.columnCount) || grid.rowCount < 1 || grid.columnCount < 1) fail();
    ids.add(p.sheetId); dimensions += grid.rowCount * grid.columnCount;
    if (dimensions > 5000000) fail();
    const rows = new Map();
    for (const block of sheet.data || []) {
      const sr = block.startRow || 0, sc = block.startColumn || 0;
      if (!Number.isInteger(sr) || !Number.isInteger(sc) || sr < 0 || sc < 0) fail();
      for (const [ri, row] of (block.rowData || []).entries()) {
        if (sr + ri >= grid.rowCount) fail();
        const cells = rows.get(sr + ri) || new Map(); rows.set(sr + ri, cells);
        for (const [ci, cell] of (row.values || []).entries()) {
          if (sc + ci >= grid.columnCount || cells.has(sc + ci)) fail();
          cells.set(sc + ci, cell);
          const raw = literal(cell);
          const address = raw ?? cell.effectiveValue?.stringValue;
          if (typeof address === 'string' && address.includes('@')) { const canonical = address.trim().toLowerCase(); index.set(canonical, (index.get(canonical) || 0) + 1); }
        }
      }
    }
    const headerCells = [...(rows.get(0) || [])];
    const headers = headerCells.map(([col, cell]) => [col, header(literal(cell) ?? cell.effectiveValue?.stringValue)]);
    const ambiguousHeader = headerCells.some(([,cell]) => literal(cell) === null && ['email',...statusHeaders,...nameHeaders].includes(header(cell.effectiveValue?.stringValue)));
    const emails = headers.filter(([,v]) => v === 'email'), statuses = headers.filter(([,v]) => statusHeaders.includes(v)), names = headers.filter(([,v]) => nameHeaders.includes(v));
    const report = {sheetId:p.sheetId, title:p.title, hidden:!!p.hidden, total:0, eligible:0, existing:0, success:0, failed:0, otherStatus:0, skipped:0, conflicts:0, excluded:false};
    reports.push(report);
    if (!emails.length && !statuses.length && !names.length) { report.excluded = true; continue; }
    const labels = headers.map(([,value]) => value).filter(Boolean);
    if (ambiguousHeader || new Set(labels).size !== labels.length || emails.length !== 1 || statuses.length !== 1 || names.length > 1) { report.conflicts++; continue; }
    const ec = emails[0][0], st = statuses[0][0];
    for (const [row, cells] of rows) {
      if (!row || ![...cells.values()].some(c => c.userEnteredValue !== undefined || c.effectiveValue !== undefined)) continue;
      report.total++;
      const status = cells.get(st), raw = literal(cells.get(ec));
      if (literal(status) === 'BERHASIL') report.success++;
      else if (literal(status) === 'GAGAL') report.failed++;
      else if (!blankStatus(status)) report.otherStatus++;
      if (raw?.trim().toLowerCase().endsWith('@mdprana.site')) { report.existing++; report.skipped++; continue; }
      const match = /^1nd0n3s1aemas\+([a-z0-9._-]+)@gmail\.com$/.exec(raw || '');
      if (!match || !blankStatus(status)) { report.skipped++; continue; }
      const target = match[1]+'@mdprana.site';
      try { inboxAlias(target); } catch { report.conflicts++; continue; }
      const protectedCell = (sheet.merges || []).some(r => intersects(r,p.sheetId,row,ec)) || (sheet.protectedRanges || []).some(r => !r.range || intersects(r.range,p.sheetId,row,ec));
      if (protectedCell) { report.conflicts++; continue; }
      candidates.push({sheetId:p.sheetId,row,column:ec,old:raw,target,headerFingerprint:hash(headers),rowFingerprint:hash([...cells].sort((a,b)=>a[0]-b[0])),report});
    }
  }
  const targets = new Map();
  for (const c of candidates) targets.set(c.target, (targets.get(c.target) || 0)+1);
  for (const c of candidates) {
    if (index.get(c.old) !== 1 || index.has(c.target) || targets.get(c.target) !== 1) c.report.conflicts++;
    else c.report.eligible++;
  }
  return {sheets:reports, eligible:reports.reduce((n,r)=>n+r.eligible,0), conflicts:reports.reduce((n,r)=>n+r.conflicts,0), applyAvailable:false, reason:APPLY_BLOCKED};
}

export async function readSnapshot(session, url, fetcher = fetch) {
  const response = await fetcher(url+'?includeGridData=true', {method:'GET', headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal:AbortSignal.timeout(20000)});
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > SNAPSHOT_LIMIT) fail();
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > SNAPSHOT_LIMIT) { await reader.cancel(); fail(); } chunks.push(Buffer.from(value)); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}

export function migrationAttachment(snapshot) {
  const snapshotJSON = JSON.stringify(snapshot), report = planMigration(snapshot);
  const body = JSON.stringify({schema:1, mode:'read-only', createdAt:new Date().toISOString(), snapshotChecksum:checksum(snapshotJSON), report, snapshot});
  if (Buffer.byteLength(body) > SNAPSHOT_LIMIT) fail();
  return new Response(body, {headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="migration-backup.json"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Backup-SHA256':checksum(body)}});
}
