import test from 'node:test';
import assert from 'node:assert/strict';
import { blankStatus, planMigration, migrationAttachment, readSnapshot, checksum, SNAPSHOT_LIMIT } from './alias-migration.js';
const str = stringValue => ({userEnteredValue:{stringValue}});
const old = tag => `1nd0n3s1aemas+${tag}@gmail.com`;
const sheet = (id, rows, extra={}) => ({properties:{sheetId:id,title:'Synthetic '+id,sheetType:'GRID',gridProperties:{rowCount:100,columnCount:20000}},data:[{rowData:[{values:['Email','Nama','Status'].map(str)},...rows.map(values=>({values}))]}],...extra});
const book = (...sheets) => ({spreadsheetId:'synthetic-private',properties:{title:'Synthetic'},namedRanges:[{name:'demo'}],sheets});
const row = (tag, status={}) => [str(old(tag)),str('Synthetic'),status];

test('exact eligibility; typed/formula/effective blank rejected; alias limits and deterministic planning', () => {
  for(const cell of [{},str(''),{effectiveValue:{stringValue:''}}]) assert.equal(blankStatus(cell),true);
  const bad = [' ','\u00a0','BERHASIL','GAGAL','unknown'].map(str).concat([{userEnteredValue:{formulaValue:'=""'},effectiveValue:{stringValue:''}},{userEnteredValue:{numberValue:0}},{effectiveValue:{boolValue:false}},{effectiveValue:{errorValue:{type:'ERROR'}}}]);
  for(const cell of bad) assert.equal(blankStatus(cell),false);
  const rows=[row('good'),...bad.map((s,i)=>row('bad'+i,s)),row('a'.repeat(64)),row('a'.repeat(65))];
  for(const address of ['1nd0n3s1aemas@gmail.com','ind0n3s1aemas+x@gmail.com',old('UPPER'),old('space')+' ','a@gmail.com','existing@mdprana.site']) rows.push([str(address),str('Synthetic'),{}]);
  rows.push([{userEnteredValue:{formulaValue:'="'+old('formula')+'"'},effectiveValue:{stringValue:old('formula')}},str('Synthetic'),{}]);
  const snapshot=book(sheet(1,rows)), before=JSON.stringify(snapshot), result=planMigration(snapshot);
  assert.equal(result.eligible,2); assert.equal(result.conflicts,1); assert.equal(result.sheets[0].existing,1);
  assert.equal(result.applyAvailable,false); assert.deepEqual(planMigration(snapshot),result); assert.equal(JSON.stringify(snapshot),before);
  const migrated=book(sheet(1,[[str('good@mdprana.site'),str('Synthetic'),{}]]));
  assert.equal(planMigration(migrated).eligible,0);
});

test('cross-sheet canonical collisions, duplicate sources/targets include non-empty status and excluded sheets', () => {
  const result=planMigration(book(sheet(1,[row('dup'),row('existing'),row('same')]),sheet(2,[row('dup',str('BERHASIL')),[str(' EXISTING@MDPRANA.SITE '),str('Synthetic'),str('GAGAL')],row('same')])));
  assert.equal(result.eligible,0); assert.equal(result.conflicts,4);
  const excluded=sheet(3,[]); excluded.data=[{rowData:[{values:[str('Other')]},{values:[str('x@mdprana.site')]}]}];
  assert.equal(planMigration(book(sheet(1,[row('x')]),excluded)).conflicts,1);
});

test('sparse offsets, wide dimensions, hidden/empty sheets, schema and protected/merged denies', () => {
  const sparse=sheet(1,[],{properties:{sheetId:1,title:'Hidden',hidden:true,sheetType:'GRID',gridProperties:{rowCount:5,columnCount:20000}},data:[{startColumn:19000,rowData:[{values:['Email','Nama','Status'].map(str)}]},{startRow:3,startColumn:19000,rowData:[{values:row('wide')}]}]});
  assert.equal(planMigration(book(sparse)).eligible,1);
  for(const extra of [{merges:[{startRowIndex:3,endRowIndex:4,startColumnIndex:19000,endColumnIndex:19001}]},{protectedRanges:[{range:{sheetId:1},warningOnly:true}]},{protectedRanges:[{namedRangeId:'unknown'}]}]) assert.equal(planMigration(book({...sparse,...extra})).conflicts,1);
  for(const headers of [['Email','Email','Status'],['Email','Nama'],['Email','Status','Status'],['Email','Nama','Agent','Status']]) {
    const s=sheet(1,[]); s.data[0].rowData[0].values=headers.map(str); assert.equal(planMigration(book(s)).conflicts,1);
  }
  assert.equal(planMigration(book(sheet(1,[]))).eligible,0);
  assert.throws(()=>planMigration(book({...sparse,properties:{...sparse.properties,sheetType:'OBJECT'}})));
  assert.throws(()=>planMigration(book(sparse,sparse)));
});

test('private complete attachment immutable snapshot and two checksums preserve typed PII/metadata', async () => {
  const s=sheet(1,[[...row('backup'),str('0012345678901234'),{userEnteredValue:{numberValue:1234},userEnteredFormat:{numberFormat:{type:'TEXT'}},effectiveFormat:{backgroundColor:{red:1}},note:'private',dataValidation:{strict:true}}]]);
  const snapshot=book(s), response=migrationAttachment(snapshot), text=await response.text(), attachment=JSON.parse(text);
  assert.equal(response.headers.get('cache-control'),'no-store'); assert.match(response.headers.get('content-disposition'),/attachment; filename="migration-backup.json"/);
  assert.equal(checksum(text),response.headers.get('X-Backup-SHA256')); assert.equal(checksum(JSON.stringify(attachment.snapshot)),attachment.snapshotChecksum);
  assert.deepEqual(attachment.snapshot,snapshot);
  attachment.snapshot.sheets[0].data[0].rowData[1].values[3]=str('changed');
  assert.notEqual(checksum(JSON.stringify(attachment.snapshot)),attachment.snapshotChecksum);
});

test('snapshot GET only, no field-mask truncation, timeout and bounded stream failure', async () => {
  const snapshot=book(sheet(1,[row('fetch')])), calls=[];
  const fetcher=async(url,options)=>{calls.push({url,options});return Response.json(snapshot);};
  assert.deepEqual(await readSnapshot({access_token:'private'},'https://sheets.example.invalid/book',fetcher),snapshot);
  assert.equal(calls[0].url,'https://sheets.example.invalid/book?includeGridData=true'); assert.equal(calls[0].options.method,'GET'); assert.equal(calls[0].options.cache,'no-store'); assert.ok(calls[0].options.signal);
  for(const response of [new Response('provider private',{status:403}),new Response('{}',{headers:{'Content-Length':String(SNAPSHOT_LIMIT+1)}}),new Response('x'.repeat(SNAPSHOT_LIMIT+1))]) await assert.rejects(()=>readSnapshot({},'synthetic',async()=>response));
});
