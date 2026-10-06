import test from 'node:test';
import assert from 'node:assert/strict';
import { email, ownedAlias, recipients, hasRecipient, safeLink, parseRows, uniqueRow, column, sheetRange, seal, unseal, messageContent } from './helpers.js';
test('email normalization and owned aliases reject query injection', () => {
  assert.equal(email(' Agent+One@GMAIL.com '),'agent+one@gmail.com');
  assert.equal(ownedAlias('1nd0n3s1aemas+agent@gmail.com'),'1nd0n3s1aemas+agent@gmail.com');
  for (const bad of ['x@gmail.com','1nd0n3s1aemas@gmail.com OR all','1nd0n3s1aemas+agent@evil.com','1nd0n3s1aemas@gmail.com\ncc:evil']) assert.throws(() => ownedAlias(bad));
});
test('recipient parsing requires exact mailbox, not substring or display name', () => {
  const alias='1nd0n3s1aemas+agent@gmail.com';
  assert.deepEqual(recipients('"Doe, Jane" <a@example.com>, b@example.com'), ['a@example.com','b@example.com']);
  assert.ok(hasRecipient([{name:'To',value:`"Agen" <${alias}>`}],alias));
  assert.ok(hasRecipient([{name:'Delivered-To',value:alias.toUpperCase()}],alias));
  assert.equal(hasRecipient([{name:'To',value:`"${alias}" <evil@example.com>`}],alias),false);
  assert.equal(hasRecipient([{name:'To',value:'1nd0n3s1aemas+agent2@gmail.com'}],alias),false);
  assert.equal(hasRecipient([{name:'Subject',value:alias}],alias),false);
});
test('only HTTPS exact LinkUMKM hosts accepted', () => {
  assert.equal(safeLink('https://linkumkm.id/verify?a=1'),'https://linkumkm.id/verify?a=1');
  assert.equal(safeLink('https://www.linkumkm.id/'),'https://www.linkumkm.id/');
  for (const url of ['http://linkumkm.id','https://linkumkm.id.evil.com','https://evil.com/linkumkm.id','javascript:alert(1)','https://user@linkumkm.id','https://linkumkm.id:8080','https://linkumkm.id.']) assert.equal(safeLink(url),null);
});
test('all rows parsed, email unique across sheets, sorted row resolved fresh', () => {
  const oldRows=parseRows('A', [['Email','Nama Agen','Status'],['one@example.com','One',''],['two@example.com','Two','GAGAL']]);
  const sorted=parseRows('A', [['Email','Nama Agen','Status'],['two@example.com','Two','GAGAL'],['one@example.com','One','']]);
  assert.equal(uniqueRow(oldRows,'one@example.com').row,2);
  assert.equal(uniqueRow(sorted,'one@example.com').row,3);
  assert.throws(() => uniqueRow([...sorted,...parseRows('B',[['Email','Agent Name','Status'],['one@example.com','Duplicate','']])],'one@example.com'),/duplikat/);
  assert.throws(() => uniqueRow(sorted,'absent@example.com'),/tidak ditemukan/);
  assert.throws(() => uniqueRow(parseRows('A',[['Email','Nama'],['one@example.com','One']]),'one@example.com'),/Kolom Status/);
  assert.deepEqual(parseRows('A',[['Email','Nama','Status'],['invalid','No','']]),[]);
  const loc=parseRows('KC Soe',[['Email','Nama','Status','Kota/Kab','KECAMATAN','desa/kelurahan','no_ktp'],['one@example.com','One','',' Kupang ','Soe','Oebesa','123']])[0];
  assert.deepEqual([loc.city,loc.district,loc.village,loc.no_ktp],['Kupang','Soe','Oebesa',undefined]);
  assert.equal(parseRows('A',[['Email','Nama'],['one@example.com','One']])[0].city,'');
});
test('A1 range escapes titles and computes status column only', () => {
  assert.equal(column(0),'A'); assert.equal(column(25),'Z'); assert.equal(column(26),'AA'); assert.equal(column(701),'ZZ');
  assert.equal(sheetRange("O'Brien",'C3'),"'O''Brien'!C3");
});
test('encrypted authenticated session rejects tampering, wrong key and expiry', () => {
  const secret='a'.repeat(32), payload={access_token:'secret-token',email:'owner',exp:Date.now()+10000};
  const value=seal(payload,secret);
  assert.ok(!value.includes('secret-token')); assert.deepEqual(unseal(value,secret),payload);
  assert.equal(unseal(value,'b'.repeat(32)),null);
  const tampered=Buffer.from(value,'base64url'); tampered[30]^=1;
  assert.equal(unseal(tampered.toString('base64url'),secret),null);
  assert.equal(unseal(seal({...payload,exp:0},secret),secret),null);
  assert.throws(() => seal(payload,'short'));
});
test('MIME traversal ignores attachment and keeps inert text fallback', () => {
  const encoded=s => Buffer.from(s).toString('base64url');
  const plain=messageContent({parts:[{mimeType:'text/plain',body:{data:encoded('Hello https://linkumkm.id/verify')}},{mimeType:'text/plain',filename:'attachment.txt',body:{data:encoded('hidden')}}]});
  assert.equal(plain.body,'Hello https://linkumkm.id/verify'); assert.deepEqual(plain.links,['https://linkumkm.id/verify']);
  const html=messageContent({mimeType:'text/html',body:{data:encoded('<script>alert(1)</script><p>Hello</p><a href="https://linkumkm.id/v?a=1&amp;b=2">Verify</a><img src="https://evil.com">')}});
  assert.equal(html.body,'Hello\nVerify'); assert.deepEqual(html.links,['https://linkumkm.id/v?a=1&b=2']);
  assert.ok(!html.body.includes('<script>'));
});
