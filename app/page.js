'use client';
import {useEffect, useRef, useState} from 'react';
import {displayDate, filterAgents, filterOptions, messageText, readableText, statusGroup} from '../lib/presentation.js';
function Icon({name}) {
  if(name==='refresh') return <svg viewBox="0 0 24 24" fill="#000" aria-hidden="true"><path d="M12 3a9 9 0 0 1 8.5 12h-3.3A6 6 0 0 0 7.8 7.8L10 10H3V3l2.6 2.6A9 9 0 0 1 12 3Z"/><path d="M12 21a9 9 0 0 1-8.5-12h3.3a6 6 0 0 0 9.4 7.2L14 14h7v7l-2.6-2.6A9 9 0 0 1 12 21Z"/></svg>;
  if(name==='block') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m5.6 18.4 12.8-12.8"/></svg>;
  const paths={inbox:'M4 4h16v16H4z M4 13h5l2 3h2l2-3h5',search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',copy:'M9 9h11v11H9z M15 5V3H3v12h2',arrow:'M7 17 17 7 M7 7h10v10',back:'M19 12H5 M11 6l-6 6 6 6',shield:'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z M8 12l3 3 5-6',check:'M5 12l4 4L19 6',funnel:'M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z',sheet:'M5 3h14v18H5z M5 9h14 M5 15h14 M12 9v12',exit:'M9 4H4v16h5 M10 12h11 M17 8l4 4-4 4'};
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.inbox}/></svg>;
}
function Badge({status}) {return <span className={'badge '+statusGroup(status)}>{status || 'Belum diisi'}</span>;}
async function api(path, options) {
  const response=await fetch(path,{cache:'no-store',...options});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error || 'Permintaan gagal.');
  return data;
}
const noLoc={sheet:'',city:'',district:'',village:''};
const locFields=[['sheet','KC (Kantor Cabang)'],['city','Kota/Kab'],['district','Kecamatan'],['village','Desa/Kelurahan']];
const filters=[['all','Semua'],['pending','Belum diisi'],['success','Berhasil'],['failed','Gagal']];
export default function Home() {
  const [session,setSession]=useState(null), [agents,setAgents]=useState([]), [selected,setSelected]=useState(null), [query,setQuery]=useState('');
  const [messages,setMessages]=useState([]), [limited,setLimited]=useState(false), [error,setError]=useState(''), [notice,setNotice]=useState('');
  const [loading,setLoading]=useState(false), [mailLoading,setMailLoading]=useState(false), [saving,setSaving]=useState(false), [choice,setChoice]=useState('');
  const [mailVersion,setMailVersion]=useState(0), [filter,setFilter]=useState('all'), [mobileDetail,setMobileDetail]=useState(false), [copyState,setCopyState]=useState(''), [sessionFailed,setSessionFailed]=useState(false), [mailFailed,setMailFailed]=useState(false);
  const [loc,setLoc]=useState(noLoc), [panelOpen,setPanelOpen]=useState(false);
  const detailHeading=useRef(null), searchInput=useRef(null), filterWrap=useRef(null), filterButton=useRef(null), filterPanel=useRef(null);
  useEffect(()=>{
    if(!panelOpen)return;
    filterPanel.current?.querySelector('select')?.focus();
    const outside=e=>{if(!filterWrap.current?.contains(e.target))setPanelOpen(false);};
    document.addEventListener('pointerdown',outside);
    return ()=>document.removeEventListener('pointerdown',outside);
  },[panelOpen]);
  function setLocField(key,value) {
    const i=locFields.findIndex(([k])=>k===key);
    setLoc(old=>({...old,...Object.fromEntries(locFields.slice(i).map(([k])=>[k,''])),[key]:value}));setMobileDetail(false);
  }
  async function loadAgents() {
    setLoading(true);setError('');
    try {const data=await api('/api/agents');setAgents(data.agents);setSelected(old=>old?data.agents.find(a=>a.email===old.email && a.sheet===old.sheet)||null:null);}
    catch(e) {setError(e.message);} finally {setLoading(false);}
  }
  async function loadSession() {
    setSessionFailed(false);setError('');
    try {const s=await api('/api/session');setSession(s);if(s.email && s.sharedReady) loadAgents();}
    catch(e) {setError(e.message);setSessionFailed(true);}
  }
  useEffect(()=>{loadSession();},[]);
  useEffect(()=>{
    let active=true;
    setMessages([]);setLimited(false);setChoice('');setNotice('');setCopyState('');setMailFailed(false);
    if(!selected) {setMailLoading(false);return;}
    setMailLoading(true);setError('');
    api('/api/inbox?email='+encodeURIComponent(selected.email)).then(data=>{if(active){setMessages(data.messages);setLimited(data.limited);}}).catch(e=>{if(active){setError(e.message);setMailFailed(true);}}).finally(()=>{if(active)setMailLoading(false);});
    return ()=>{active=false;};
  },[selected?.email,mailVersion]);
  useEffect(()=>{if(mobileDetail)detailHeading.current?.focus();},[mobileDetail,selected?.email,selected?.sheet]);
  async function submit(event) {
    event.preventDefault();if(!selected || !choice || saving)return;
    setSaving(true);setError('');setNotice('');
    try {
      const result=await api('/api/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:selected.email,status:choice})});
      setAgents(rows=>rows.map(a=>a.email===result.email?{...a,status:result.status}:a));
      setSelected(a=>({...a,status:result.status}));setNotice('Status '+result.status+' tersimpan di Google Sheets.');
    } catch(e) {setError(e.message);} finally {setSaving(false);}
  }
  async function logout() {
    try {await api('/api/auth/logout',{method:'POST'});setAgents([]);setMessages([]);setSelected(null);setSession(s=>({...s,email:null}));setError('');setNotice('');setCopyState('');}catch(e){setError(e.message);}
  }
  async function copyAlias() {
    try {await navigator.clipboard.writeText(selected.email);setCopyState('Alias disalin.');}
    catch {setCopyState('Tidak dapat menyalin. Pilih teks alias lalu salin secara manual.');}
  }
  const filtered=filterAgents(agents,query,filter,loc), scoped=filterAgents(agents,'','all',loc), options=filterOptions(agents,loc), activeLoc=Object.values(loc).filter(Boolean).length;
  const counts={all:scoped.length,pending:scoped.filter(a=>statusGroup(a.status)==='pending').length,success:scoped.filter(a=>statusGroup(a.status)==='success').length,failed:scoped.filter(a=>statusGroup(a.status)==='failed').length};
  return <>
    <a href="#content" className="skip">Lewati ke konten</a>
    <header className="top"><div className="topinner">
      <a className="brand" href="/" aria-label="Agen Inbox, beranda"><img src="/icon.svg" alt="" width="42" height="42"/><span>Agen Inbox<small>WORKSPACE PRIBADI</small></span></a>
      <span className="headerlabel"><Icon name="inbox"/>Inbox & pencatatan</span>
      {session?.email?<div className="account"><span className="accountavatar" aria-hidden="true">IE</span><span className="accountemail">{session.email}<small>{session.sharedReady?'Koneksi pemilik siap':'Koneksi pemilik belum siap'}</small></span><button onClick={logout} disabled={saving}><Icon name="exit"/>Keluar</button></div>:<span className="privacy"><Icon name="shield"/>Akses terbatas</span>}
    </div></header>
    <main id="content">
      <section className="intro"><div><p className="eyebrow">RUANG KERJA AGEN</p><h1>Inbox rapi. Tindak lanjut pasti.</h1><p>Email alias, tautan pilihan, dan hasil manual. Semua di satu tempat.</p></div><div className="workflow" aria-label="Alur kerja"><span><b>01</b> Pilih agen</span><span><b>02</b> Tinjau email</span><span><b>03</b> Catat hasil</span></div></section>
      {error && <div className="alert" role="alert"><strong>Permintaan belum selesai.</strong> {error}</div>}
      <div role="status" aria-live="polite" className={notice?'notice':'sr-only'}>{notice}</div>
      {!session?<section className="welcome"><div className="welcomeicon"><Icon name="shield"/></div><p className="eyebrow">AKSES PRIBADI</p><h2>{sessionFailed?'Sesi belum dapat dimuat.':'Menyiapkan ruang kerja…'}</h2><p>{sessionFailed?'Periksa koneksi, lalu coba kembali.':'Memeriksa sesi sebelum menampilkan data agen.'}</p>{sessionFailed?<button onClick={loadSession}>Coba lagi</button>:<p role="status">Memeriksa sesi…</p>}</section>:!session.configured?<section className="welcome"><div className="welcomeicon"><Icon name="sheet"/></div><p className="eyebrow">PENYIAPAN DIPERLUKAN</p><h2>Hubungkan sumber kerja Anda.</h2><p>Konfigurasi server belum lengkap. Data Gmail dan Sheets tidak ditampilkan sampai akses siap.</p><ul className="configlist">{session.missing.map(m=><li key={m}><code>{m}</code></li>)}</ul><p>Lihat README untuk konfigurasi OAuth dan spreadsheet. Tidak ada data contoh.</p></section>:!session.email?<section className="loginlayout">
        <div className="welcome"><div className="welcomeicon"><Icon name="inbox"/></div><p className="eyebrow">INBOX ANDA, RUANG ANDA</p><h2>Selamat datang di<br/>Agen Inbox.</h2><p>Masuk untuk membaca email agen dan mencatat hasil ke Google Sheets.</p><div className="owner"><Icon name="shield"/><span>Akses pemilik & anggota tim<strong>Masuk dengan akun yang diizinkan</strong></span></div>{typeof window!=='undefined' && new URLSearchParams(window.location.search).get('auth')==='failed' && <p className="alert" role="alert">Login gagal. Pastikan akun benar dan semua izin Google disetujui.</p>}<a className="primary button" href="/api/auth/login"><img src="/google.png" width="20" height="20" alt="" aria-hidden="true"/>Masuk dengan Google<Icon name="arrow"/></a><p className="muted">Status Sheets berubah hanya setelah Anda menyimpan.</p></div>
        <aside className="loginaside"><span className="eyebrow">ALUR YANG TETAP ANDA KENDALIKAN</span><h2>Satu inbox.<br/>Tiga langkah jelas.</h2><ol><li><span>01</span><div><strong>Temukan agen</strong><p>Daftar langsung dari spreadsheet Anda.</p></div></li><li><span>02</span><div><strong>Tinjau pesan</strong><p>Baca email alias. Buka tautan secara manual.</p></div></li><li><span>03</span><div><strong>Simpan hasil</strong><p>Pilih BERHASIL atau GAGAL setelah peninjauan.</p></div></li></ol><p className="asidenote"><Icon name="shield"/>Tanpa aktivasi otomatis. Kendali tetap di tangan Anda.</p></aside>
      </section>:!session.sharedReady?<section className="welcome"><div className="welcomeicon"><Icon name="shield"/></div><h2>Koneksi Google pemilik belum siap.</h2>{typeof window!=='undefined' && new URLSearchParams(window.location.search).get('auth')==='connect_failed' && <p className="alert" role="alert">Koneksi gagal. Pemilik harus menyetujui izin Gmail dan Sheets dengan akun pemilik; periksa penyimpanan server.</p>}<p>{session.connectionError || 'Gmail dan Sheets memakai koneksi bersama milik pemilik.'}</p>{session.owner?<a className="primary button" href="/api/auth/connect">Hubungkan Gmail & Sheets<Icon name="arrow"/></a>:<p>Hubungi pemilik 1nd0n3s1aemas@gmail.com untuk menghubungkan ulang. Gmail anggota tidak digunakan.</p>}<button onClick={loadSession}>Periksa kembali</button></section>:<>
        <div className="notice"><span>Koneksi bersama pemilik siap. Gmail anggota tidak digunakan.</span>{session.owner && <a className="button" href="/api/auth/connect">Hubungkan ulang Gmail & Sheets</a>}</div>
        <section className="stats" aria-label="Ringkasan status agen">{filters.map(([value,label],i)=><button key={value} onClick={()=>{setFilter(value);setMobileDetail(false);}} className={'stat '+value} aria-pressed={filter===value} disabled={saving}><span className="staticon"><Icon name={i===0?'sheet':i===2?'check':i===3?'block':'inbox'}/></span><span><small>{label}</small><strong>{loading?'…':counts[value]}</strong></span><span className="statcue" aria-hidden="true">↗</span></button>)}<div className="filterwrap" ref={filterWrap} onKeyDown={e=>{if(e.key==='Escape' && panelOpen){e.stopPropagation();setPanelOpen(false);filterButton.current?.focus();}}}><button ref={filterButton} className="stat filterbutton" onClick={()=>setPanelOpen(o=>!o)} aria-expanded={panelOpen} aria-controls="filter-panel" disabled={saving}><Icon name="funnel"/>Filter{activeLoc>0 && <span className="filtercount"><span className="sr-only">, </span>{activeLoc}<span className="sr-only"> aktif</span></span>}</button>{panelOpen && <div id="filter-panel" ref={filterPanel} className="filterpanel" role="dialog" aria-label="Filter lokasi agen">{locFields.map(([key,label])=><label key={key}>{label}<select value={loc[key]} onChange={e=>setLocField(key,e.target.value)}><option value="">Semua</option>{options[key].map(v=><option key={v} value={v}>{v}</option>)}</select></label>)}<button type="button" onClick={()=>setLoc(noLoc)} disabled={!activeLoc}>Reset filter</button></div>}</div></section>
        <div className={'workspace '+(mobileDetail?'show-detail':'show-list')}>
          <aside className="agents" aria-label="Daftar agen">
            <div className="panelhead"><div><p className="eyebrow">DARI GOOGLE SHEETS</p><h2>Daftar agen</h2></div><button className="iconbutton" onClick={loadAgents} disabled={loading || saving} aria-label="Muat ulang daftar agen"><Icon name="refresh"/></button></div>
            <div className="listtools"><label className="search" htmlFor="agent-search">Cari agen<span className="searchfield"><Icon name="search"/><input ref={searchInput} id="agent-search" name="agent-search" type="search" autoComplete="off" placeholder="Nama, email, atau lembar" value={query} onChange={e=>setQuery(e.target.value)}/></span></label><div className="filters" aria-label="Filter status">{filters.map(([value,label])=><button key={value} onClick={()=>setFilter(value)} aria-pressed={filter===value}>{label}<span>{counts[value]}</span></button>)}</div><p className="resultcount" role="status">{loading?'Memuat spreadsheet…':`${filtered.length} dari ${agents.length} agen ditampilkan`}</p></div>
            <div className="agentlist" aria-busy={loading}>{loading && <div className="loadingstate" role="status"><Icon name="sheet"/><strong>Memuat daftar agen…</strong><p>Mengambil baris terbaru dari Google Sheets.</p></div>}{!loading && !filtered.length && <div className="empty"><Icon name="search"/><h3>{agents.length?'Belum ada yang cocok.':'Daftar agen masih kosong.'}</h3><p>{agents.length?'Coba kata lain atau tampilkan semua status.':'Periksa header Email dan Nama Agen di spreadsheet.'}</p>{agents.length>0 && <button onClick={()=>{setQuery('');setFilter('all');setLoc(noLoc);}}>Reset pencarian</button>}</div>}{filtered.map((a,i)=><button className={'agent '+(selected?.email===a.email && selected?.sheet===a.sheet?'selected':'')} key={a.email+a.sheet+i} onClick={()=>{setSelected(a);setMobileDetail(true);}} disabled={saving} aria-pressed={selected?.email===a.email && selected?.sheet===a.sheet}><span className="agenttop"><span className="agentavatar" aria-hidden="true">{(a.name || a.email).slice(0,2).toUpperCase()}</span><span className="agentname">{a.name || 'Tanpa nama'}<span className="email">{a.email}</span></span><span className="agentchevron" aria-hidden="true">›</span></span><span className="agentbottom"><span className="sheetname">{a.sheet}</span><Badge status={a.status}/></span>{a.duplicate && <span className="duplicate">Email duplikat · hanya baca</span>}</button>)}</div>
            <div className="listfoot"><Icon name="sheet"/>Sumber langsung · Google Sheets</div>
          </aside>
          <section className="detail" aria-label="Detail inbox">
            <button className="mobileback" disabled={saving} onClick={()=>{setMobileDetail(false);requestAnimationFrame(()=>searchInput.current?.focus());}}><Icon name="back"/>Kembali ke daftar agen</button>
            {!selected?<div className="emptydetail"><div className="inboxillustration" aria-hidden="true"><span className="paper paper-one"/><span className="paper paper-two"/><Icon name="inbox"/></div><p className="eyebrow">SIAP UNTUK DITINJAU</p><h2>Mulai dari satu agen.</h2><p>Pilih nama di daftar untuk melihat email alias dan mencatat hasil peninjauan.</p><div className="emptyhint"><Icon name="shield"/>Pesan hanya ditampilkan jika penerima cocok persis dengan alias pilihan.</div></div>:<>
              <div className="detailhead"><div className="detailtitle"><span className="eyebrow">INBOX ALIAS</span><h2 ref={detailHeading} tabIndex={-1}>{selected.name || 'Tanpa nama'}</h2><div className="aliasrow"><span className="email">{selected.email}</span><button className="copybutton" onClick={copyAlias} aria-label="Salin alias email"><Icon name="copy"/>{copyState==='Alias disalin.'?'Disalin':'Salin'}</button></div><div role="status" className={copyState?'copyfeedback':'sr-only'}>{copyState}</div></div><div className="detailactions"><Badge status={selected.status}/><button disabled={mailLoading || saving} onClick={()=>setMailVersion(v=>v+1)}><Icon name="refresh"/>Segarkan</button></div></div>
              <div className="mailheading"><h3><Icon name="inbox"/>Pesan masuk</h3><span>{mailLoading?'Memuat…':`${messages.length} pesan`}</span></div>
              <div className="mail" aria-busy={mailLoading}>
                {mailLoading?<div className="loadingstate" role="status"><Icon name="inbox"/><strong>Menelusuri inbox alias…</strong><p>Mencocokkan penerima email dengan alias ini.</p></div>:mailFailed?<div className="empty"><Icon name="refresh"/><h3>Inbox belum dapat dimuat.</h3><p>Periksa koneksi atau izin Gmail, lalu segarkan kembali.</p><button onClick={()=>setMailVersion(v=>v+1)}>Coba lagi</button></div>:messages.length?messages.map((m,i)=><details key={m.id} open={i===0}>
                  <summary><span className="messageindex" aria-hidden="true">{String(i+1).padStart(2,'0')}</span><span className="messagesubject">{readableText(m.subject)}<small>{displayDate(m.date)} · {readableText(m.from)}</small></span><span className="disclosure" aria-hidden="true">⌄</span></summary>
                  {m.links.length>0 && <div className="links"><div className="linkheading"><Icon name="arrow"/><strong>Tautan dengan hostname yang diizinkan</strong></div><p>Hostname cocok dengan daftar izin LinkUMKM. Ini bukan verifikasi pengirim, keamanan, atau tujuan pengalihan. Tinjau pesan sebelum membuka.</p><div className="linkactions">{m.links.map((link,j)=><a className="button primary" key={link} href={link} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Buka tautan LinkUMKM{m.links.length>1?` ${j+1}`:''}<Icon name="arrow"/><span className="sr-only"> (tab baru)</span></a>)}</div><small>Dibuka manual di tab baru. Tidak ada aktivasi otomatis.</small></div>}
                  <div className="messagebody">{m.html?<><span className="bodylabel">TAMPILAN EMAIL · HTML TERISOLASI</span><p className="previewnote">Format pengirim dipertahankan sejauh memungkinkan. Gambar, pelacak, dan tautan di dalam pratinjau dinonaktifkan. Tampilan dapat berbeda dari Gmail.</p><iframe className="emailpreview" title={`Pratinjau email ${i+1}: ${readableText(m.subject)}`} sandbox="" referrerPolicy="no-referrer" srcDoc={m.html}/><details className="textfallback"><summary>Lihat versi teks</summary><pre>{messageText(m.body) || 'Tidak ada versi teks.'}</pre></details></>:<><span className="bodylabel">ISI EMAIL · TEKS SAJA</span><pre>{messageText(m.body) || 'Tidak ada isi teks yang dapat ditampilkan.'}</pre></>}</div>
                </details>):<div className="empty"><Icon name="inbox"/><h3>Belum ada email yang cocok.</h3><p>Pesan harus ditujukan persis ke alias ini. Hanya akun utama dan alias + akun pribadi yang didukung.</p><button onClick={()=>setMailVersion(v=>v+1)}>Periksa kembali</button></div>}
                {limited && <p className="limitnote">Menampilkan hingga 50 hasil pencarian terbaru. Email lain mungkin masih tersedia di Gmail.</p>}
              </div>
              <form className="statusform" onSubmit={submit}><div className="statusintro"><span className="stepnumber">03</span><div><h3>Catat hasil peninjauan</h3><p>Keputusan Anda, bukan hasil otomatis. Status saat ini: <strong>{selected.status || 'Belum diisi'}</strong>.</p></div></div>{!selected.writable && <p className="alert">Tidak dapat menyimpan: email duplikat atau kolom Status tidak ditemukan.</p>}<fieldset disabled={saving || !selected.writable}><legend>Pilih hasil manual</legend><label className="option success"><input type="radio" name="status" value="BERHASIL" checked={choice==='BERHASIL'} onChange={e=>setChoice(e.target.value)}/><span>BERHASIL<small>Peninjauan berhasil</small></span></label><label className="option failed"><input type="radio" name="status" value="GAGAL" checked={choice==='GAGAL'} onChange={e=>setChoice(e.target.value)}/><span>GAGAL<small>Peninjauan gagal</small></span></label></fieldset><div className="savebar"><p><Icon name="sheet"/>Hanya sel Status email ini yang diubah. Jangan urutkan lembar saat menyimpan.</p><button className="primary" disabled={!choice || saving || !selected.writable}><Icon name="check"/>{saving?'Menyimpan…':'Simpan ke Sheets'}</button></div></form>
            </>}
          </section>
        </div>
      </>}
      <footer><span><img src="/icon.svg" alt="" width="20" height="20"/>Agen Inbox <span>© {new Date().getFullYear()}</span></span><span>Tidak ada aktivasi otomatis · Data agen tidak disimpan di aplikasi</span></footer>
    </main>
  </>;
}
