import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readableText, messageText, filterAgents, statusGroup, displayDate} from './presentation.js';
import {emailPreview, PREVIEW_CSP} from './email-preview.js';
import {messageContent} from './helpers.js';
test('presentation decodes entities without interpreting markup; URLs not visible in text',()=>{
  assert.equal(readableText('&copy; &amp; &#169; &#x1F600; &#0;'), '© & © 😀 &#0;');
  assert.equal(messageText('Open https://example.invalid/private-value'), 'Open [Tautan dalam pesan — lihat bagian tautan di bawah]');
  assert.equal(displayDate('invalid'),'Tanggal tidak tersedia');
});
test('real row filters keep unknown statuses pending and combine search/status',()=>{
  const rows=[{name:'Satu',email:'one@example.invalid',sheet:'A',status:'BERHASIL'},{name:'Dua',email:'two@example.invalid',sheet:'B',status:''},{name:'Tiga',email:'three@example.invalid',sheet:'B',status:'GAGAL'}];
  assert.equal(filterAgents(rows,' B ','pending').length,1);
  assert.equal(filterAgents(rows,'Satu','failed').length,0);
  assert.equal(statusGroup('OTHER'),'pending');
});
test('HTML MIME preserved, named and disposition attachments including nested excluded',()=>{
  const part=(mimeType,text,extra={})=>({mimeType,body:{data:Buffer.from(text).toString('base64url')},...extra});
  const result=messageContent({parts:[part('text/plain','Plain version'),part('text/html','<table style="background-color:#eee"><tr><td>HTML version &copy;</td></tr></table>'),part('text/html','Named attachment',{filename:'file.html'}),{headers:[{name:'Content-Disposition',value:'attachment'}],parts:[part('text/html','Nested attachment')]}]});
  assert.equal(result.body,'Plain version');assert.match(result.html,/<table style="background-color:#eee">/);assert.match(result.html,/HTML version/);assert.doesNotMatch(result.html,/attachment/);
});
test('preview strips active HTML, navigation, refresh, resource attributes; CSP before content',()=>{
  const html=emailPreview('<meta http-equiv="refresh" content="0;url=https://example.invalid"><base href="https://example.invalid"><script>alert(1)</script><iframe src="https://example.invalid"></iframe><form action="https://example.invalid"><input><button>Send</button></form><img src="https://example.invalid/pixel"><a href="https://example.invalid" target="_top" onclick="alert(1)">Link</a><div style="color:red">Text</div>');
  assert.doesNotMatch(html,/<(?:script|iframe|form|input|button|img|base)\b|http-equiv="refresh"|\b(?:href|src|target|onclick|action)=/);
  assert.match(html,/<a>Link<\/a>/);assert.match(html,/style="color:red"/);assert.ok(html.indexOf('Content-Security-Policy')<html.indexOf('<a>'));
  assert.match(PREVIEW_CSP,/default-src 'none'/);assert.match(PREVIEW_CSP,/form-action 'none'/);assert.match(PREVIEW_CSP,/img-src 'none'/);
  const page=readFileSync(new URL('../app/page.js',import.meta.url),'utf8');
  assert.match(page,/sandbox=""/);assert.match(page,/srcDoc=\{m.html\}/);assert.doesNotMatch(page,/allow-scripts|allow-same-origin|dangerouslySetInnerHTML/);
});
