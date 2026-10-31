'use client';
import {useEffect, useRef, useState} from 'react';
import {displayDate, filterAgents, filterOptions, messageText, readableText, statusGroup} from '../lib/presentation.js';
function Icon({name}) {
  if(name==='refresh') return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3a9 9 0 0 1 8.5 12h-3.3A6 6 0 0 0 7.8 7.8L10 10H3V3l2.6 2.6A9 9 0 0 1 12 3Z"/><path d="M12 21a9 9 0 0 1-8.5-12h3.3a6 6 0 0 0 9.4 7.2L14 14h7v7l-2.6-2.6A9 9 0 0 1 12 21Z"/></svg>;
  if(name==='block') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m5.6 18.4 12.8-12.8"/></svg>;
  if(name==='sparkle') return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0c.7 6.4 4.6 10.3 12 12-7.4 1.7-11.3 5.6-12 12-.7-6.4-4.6-10.3-12-12C7.4 10.3 11.3 6.4 12 0Z"/></svg>;
  const paths={inbox:'M4 4h16v16H4z M4 13h5l2 3h2l2-3h5',search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',copy:'M9 9h11v11H9z M15 5V3H3v12h2',arrow:'M7 17 17 7 M7 7h10v10',back:'M19 12H5 M11 6l-6 6 6 6',shield:'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z M8 12l3 3 5-6',check:'M5 12l4 4L19 6',funnel:'M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z',sheet:'M5 3h14v18H5z M5 9h14 M5 15h14 M12 9v12',exit:'M9 4H4v16h5 M10 12h11 M17 8l4 4-4 4',clock:'M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',building:'M4 21V5l8-3 8 3v16 M9 21v-5h6v5 M9 9h.01 M15 9h.01',layers:'M12 3 2 8l10 5 10-5z M2 16l10 5 10-5'};
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.inbox}/></svg>;
}
// Same glyph as app/icon.svg, without the black tile; colour follows currentColor.
function Glyph() {return <svg className="glyph" viewBox="12 12 40 40" aria-hidden="true"><path d="M16 34v10a4 4 0 0 0 4 4h24a4 4 0 0 0 4-4V34M16 34l5-16h22l5 16M16 34h9l3 5h8l3-5h9" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>;}
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
const filterIcons={all:'inbox',pending:'clock',success:'check',failed:'block'};
const year=new Date().getFullYear();
const footer=<footer className="foot"><span><img src="/icon.svg" alt="" width="20" height="20"/>Agen Inbox <span>© {year}</span></span><span>Tidak ada aktivasi otomatis · Data agen tidak disimpan di aplikasi</span></footer>;
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
  useEffect(()=>{
    const key=e=>{if((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==='k' && searchInput.current){e.preventDefault();searchInput.current.focus();}};
    document.addEventListener('keydown',key);
    return ()=>document.removeEventListener('keydown',key);
  },[]);
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
  const sheets=[...new Set(agents.map(a=>a.sheet).filter(Boolean))].sort((x,y)=>x.localeCompare(y,'id'));
  const authParam=typeof window!=='undefined'?new URLSearchParams(window.location.search).get('auth'):null;
  const alerts=<>{error && <div className="alert" role="alert"><strong>Permintaan belum selesai.</strong> {error}</div>}<div role="status" aria-live="polite" className={notice?'notice':'sr-only'}>{notice}</div></>;
  const pickFilter=value=>{setFilter(value);setMobileDetail(false);};
  // Shared by desktop sidebar and mobile pill row; only one is displayed at a time.
  const menu=<>
    <p className="menulabel">MENU UTAMA</p>
    <div className="menugroup"><a className="menuitem active" href="#content" aria-current="page"><Icon name="inbox"/><span>Inbox agen</span></a>
    {filters.map(([value,label])=><button key={value} className="menuitem" onClick={()=>pickFilter(value)} aria-pressed={filter===value} disabled={saving}><Icon name={filterIcons[value]}/><span>{label}</span><span className="menucount">{loading?'…':counts[value]}</span></button>)}</div>
    <p className="menulabel">KANTOR CABANG</p>
    <div className="menugroup"><button className="menuitem" onClick={()=>setLocField('sheet','')} aria-pressed={!loc.sheet} disabled={saving}><Icon name="layers"/><span>Semua KC</span></button>
    {sheets.map(s=><button key={s} className="menuitem" onClick={()=>setLocField('sheet',s)} aria-pressed={loc.sheet===s} disabled={saving}><Icon name="building"/><span className="menutext">{s}</span></button>)}</div>
  </>;
  const skip=<a href="#content" className="skip">Lewati ke konten</a>;
  const card=children=><>{skip}<main id="content" className="centered"><section className="welcome"><div className="welcomeicon"><img src="/icon.svg" alt="" width="48" height="48"/></div>{alerts}{children}</section>{footer}</main></>;

  if(!session) return card(<><p className="eyebrow">AKSES PRIBADI</p><h2>{sessionFailed?'Sesi belum dapat dimuat.':'Menyiapkan ruang kerja…'}</h2><p>{sessionFailed?'Periksa koneksi, lalu coba kembali.':'Memeriksa sesi sebelum menampilkan data agen.'}</p>{sessionFailed?<button onClick={loadSession}>Coba lagi</button>:<p role="status">Memeriksa sesi…</p>}</>);
  if(!session.configured) return card(<><p className="eyebrow">PENYIAPAN DIPERLUKAN</p><h2>Hubungkan sumber kerja Anda.</h2><p>Konfigurasi server belum lengkap. Data Gmail dan Sheets tidak ditampilkan sampai akses siap.</p><ul className="configlist">{session.missing.map(m=><li key={m}><code>{m}</code></li>)}</ul><p>Lihat README untuk konfigurasi OAuth dan spreadsheet. Tidak ada data contoh.</p></>);
  if(!session.email) return <>{skip}<main id="content" className="login">
    <section className="loginform">
      <div className="loginstack">
        <h1>Masuk ke Agen Inbox</h1>
        <p className="muted">Khusus akun tim yang diizinkan. <a href="mailto:1nd0n3s1aemas@gmail.com?subject=Akses%20Agen%20Inbox">Minta akses</a></p>
        {alerts}
        {authParam==='failed' && <p className="alert" role="alert">Login gagal. Pastikan akun benar dan semua izin Google disetujui.</p>}
        <form method="get" action="/api/auth/login" className="loginfields">
          <label htmlFor="login-hint">Email Google <span className="req" aria-hidden="true">*</span></label>
          <input id="login-hint" type="email" name="login_hint" autoComplete="email" placeholder="nama@gmail.com" required/>
          <button className="primary block" type="submit"><span className="gcircle"><img src="/google.png" width="20" height="20" alt="" aria-hidden="true"/></span>Lanjutkan dengan Google</button>
        </form>
        <div className="divider"><span>atau</span></div>
        <a className="button block" href="/api/auth/login"><img src="/google.png" width="20" height="20" alt="" aria-hidden="true"/>Pilih akun Google lain</a>
      </div>
    </section>
    <aside className="loginpanel">
      <div className="loginstack">
        <div className="loginbrand"><span className="brandcircle"><Glyph/></span>Agen Inbox</div>
        <h2>Satu inbox untuk<br/>setiap alias agen.</h2>
        <p>Baca email alias, buka tautan LinkUMKM secara manual, lalu catat BERHASIL atau GAGAL langsung ke Google Sheets.</p>
        <div className="services"><span className="circles" aria-hidden="true"><span>G</span><span>S</span></span><span>Terhubung ke <strong>2</strong> layanan Google: Gmail dan Sheets.</span></div>
      </div>
    </aside>
  </main></>;
  if(!session.sharedReady) return card(<><h2>Koneksi Google pemilik belum siap.</h2>{authParam==='connect_failed' && <p className="alert" role="alert">Koneksi gagal. Pemilik harus menyetujui izin Gmail dan Sheets dengan akun pemilik; periksa penyimpanan server.</p>}<p>{session.connectionError || 'Gmail dan Sheets memakai koneksi bersama milik pemilik.'}</p>{session.owner?<a className="primary button" href="/api/auth/connect">Hubungkan Gmail & Sheets<Icon name="arrow"/></a>:<p>Hubungi pemilik 1nd0n3s1aemas@gmail.com untuk menghubungkan ulang. Gmail anggota tidak digunakan.</p>}<button onClick={loadSession}>Periksa kembali</button></>);

  const initials=(session.email.split('@')[0].replace(/[^a-z0-9]/gi,'').slice(0,2) || '?').toUpperCase();
  return <>{skip}<div className="app">
    <aside className="sidebar" aria-label="Navigasi">
      <a className="brand" href="/" aria-label="Agen Inbox, beranda"><img src="/icon.svg" alt="" width="32" height="32"/><span>Agen Inbox</span></a>
      <nav className="menu" aria-label="Menu utama">{menu}</nav>
      {session.owner && <div className="ownercard"><span className="ownersparkle"><Icon name="sparkle"/></span><strong>Koneksi Google</strong><p>Gmail & Sheets memakai akun pemilik.</p><a className="ownerbutton" href="/api/auth/connect">Hubungkan ulang</a></div>}
      <div className="profile"><span className="avatar" aria-hidden="true">{initials}</span><span className="profiletext"><span className="profileemail">{session.email}</span><small>Koneksi pemilik siap. Gmail anggota tidak digunakan.</small></span><button className="iconbutton" onClick={logout} disabled={saving} aria-label="Keluar"><Icon name="exit"/></button></div>
    </aside>
    <div className="appmain">
      <header className="apphead">
        <label className="search" htmlFor="agent-search"><span className="sr-only">Cari agen</span><Icon name="search"/><input ref={searchInput} id="agent-search" name="agent-search" type="search" autoComplete="off" placeholder="Nama, email, atau lembar" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')e.currentTarget.blur();}}/><kbd aria-hidden="true">⌘K</kbd></label>
        <div className="headactions">
          <div className="filterwrap" ref={filterWrap} onKeyDown={e=>{if(e.key==='Escape' && panelOpen){e.stopPropagation();setPanelOpen(false);filterButton.current?.focus();}}}><button ref={filterButton} className="filterbutton" onClick={()=>setPanelOpen(o=>!o)} aria-expanded={panelOpen} aria-controls="filter-panel" disabled={saving}><Icon name="funnel"/>Filter{activeLoc>0 && <span className="filtercount"><span className="sr-only">, </span>{activeLoc}<span className="sr-only"> aktif</span></span>}</button>{panelOpen && <div id="filter-panel" ref={filterPanel} className="filterpanel" role="dialog" aria-label="Filter lokasi agen">{locFields.map(([key,label])=><label key={key}>{label}<select value={loc[key]} onChange={e=>setLocField(key,e.target.value)}><option value="">Semua</option>{options[key].map(v=><option key={v} value={v}>{v}</option>)}</select></label>)}<button type="button" onClick={()=>setLoc(noLoc)} disabled={!activeLoc}>Reset filter</button></div>}</div>
          <button className="primary" onClick={loadAgents} disabled={loading || saving}><Icon name="refresh"/>Muat ulang data</button>
        </div>
      </header>
      <nav className="mobilemenu" aria-label="Menu utama">{menu}{session.owner && <a className="menuitem" href="/api/auth/connect"><Icon name="refresh"/><span>Hubungkan ulang Gmail & Sheets</span></a>}</nav>
      <main id="content" className="content">
        <div className="pagetitle"><h1>Inbox agen</h1><p>Email alias dan hasil peninjauan, langsung dari Google Sheets.</p></div>
        {alerts}
        <section className="stats" aria-label="Ringkasan status agen">{filters.map(([value,label])=><button key={value} onClick={()=>pickFilter(value)} className={'stat '+value} aria-pressed={filter===value} disabled={saving}><span className="stattop"><span className="staticon"><Icon name={filterIcons[value]}/></span>{value!=='all' && <span className="statshare" title="dari total">{counts.all?Math.round(counts[value]/counts.all*100):0}%<span className="sr-only"> dari total</span></span>}</span><small>{label}</small><strong>{loading?'…':counts[value]}</strong></button>)}</section>
        <div className={'workspace '+(mobileDetail?'show-detail':'show-list')}>
          <aside className="agents" aria-label="Daftar agen">
            <div className="panelhead"><h2>Daftar agen</h2><p className="resultcount" role="status">{loading?'Memuat spreadsheet…':`${filtered.length} dari ${agents.length} agen ditampilkan`}</p></div>
            <div className="agentlist" aria-busy={loading}>{loading && <div className="loadingstate" role="status"><Icon name="sheet"/><strong>Memuat daftar agen…</strong><p>Mengambil baris terbaru dari Google Sheets.</p></div>}{!loading && !filtered.length && <div className="empty"><Icon name="search"/><h3>{agents.length?'Belum ada yang cocok.':'Daftar agen masih kosong.'}</h3><p>{agents.length?'Coba kata lain atau tampilkan semua status.':'Periksa header Email dan Nama Agen di spreadsheet.'}</p>{agents.length>0 && <button onClick={()=>{setQuery('');setFilter('all');setLoc(noLoc);}}>Reset pencarian</button>}</div>}{filtered.map((a,i)=><button className={'agent '+(selected?.email===a.email && selected?.sheet===a.sheet?'selected':'')} key={a.email+a.sheet+i} onClick={()=>{setSelected(a);setMobileDetail(true);}} disabled={saving} aria-pressed={selected?.email===a.email && selected?.sheet===a.sheet}><span className="agentavatar" aria-hidden="true">{(a.name || a.email).slice(0,2).toUpperCase()}</span><span className="agentinfo"><span className="agentname">{a.name || 'Tanpa nama'}</span><span className="email">{a.email}</span><span className="agentmeta"><span className="sheetname">{a.sheet}</span><Badge status={a.status}/></span>{a.duplicate && <span className="duplicate">Email duplikat · hanya baca</span>}</span></button>)}</div>
          </aside>
          <section className="detail" aria-label="Detail inbox">
            <button className="mobileback" disabled={saving} onClick={()=>{setMobileDetail(false);requestAnimationFrame(()=>searchInput.current?.focus());}}><Icon name="back"/>Kembali ke daftar agen</button>
            {!selected?<div className="emptydetail"><span className="emptyglyph"><Glyph/></span><h2>Mulai dari satu agen.</h2><p>Pilih nama di daftar untuk melihat email alias dan mencatat hasil peninjauan.</p><p className="muted small"><Icon name="shield"/>Pesan hanya ditampilkan jika penerima cocok persis dengan alias pilihan.</p></div>:<>
              <div className="detailhead"><div className="detailtitle"><span className="eyebrow">INBOX ALIAS</span><h2 ref={detailHeading} tabIndex={-1}>{selected.name || 'Tanpa nama'}</h2><div className="aliasrow"><span className="email">{selected.email}</span><button className="copybutton" onClick={copyAlias} aria-label="Salin alias email"><Icon name="copy"/>{copyState==='Alias disalin.'?'Disalin':'Salin'}</button></div><div role="status" className={copyState?'copyfeedback':'sr-only'}>{copyState}</div></div><div className="detailactions"><Badge status={selected.status}/><button disabled={mailLoading || saving} onClick={()=>setMailVersion(v=>v+1)}><Icon name="refresh"/>Segarkan</button></div></div>
              <div className="mailheading"><h3><Icon name="inbox"/>Pesan masuk</h3><span>{mailLoading?'Memuat…':`${messages.length} pesan`}</span></div>
              <div className="mail" aria-busy={mailLoading}>
                {mailLoading?<div className="loadingstate" role="status"><Icon name="inbox"/><strong>Menelusuri inbox alias…</strong><p>Mencocokkan penerima email dengan alias ini.</p></div>:mailFailed?<div className="empty"><Icon name="refresh"/><h3>Inbox belum dapat dimuat.</h3><p>Periksa koneksi atau izin Gmail, lalu segarkan kembali.</p><button onClick={()=>setMailVersion(v=>v+1)}>Coba lagi</button></div>:messages.length?messages.map((m,i)=><details key={m.id} open={i===0}>
                  <summary><span className="messageindex" aria-hidden="true">{String(i+1).padStart(2,'0')}</span><span className="messagesubject">{readableText(m.subject)}<small><span>{displayDate(m.date)}</span><span className="sep" aria-hidden="true"> · </span><span>{readableText(m.from)}</span></small></span><span className="disclosure" aria-hidden="true">⌄</span></summary>
                  {m.links.length>0 && <div className="links"><div className="linkheading"><Icon name="arrow"/><strong>Tautan dengan hostname yang diizinkan</strong></div><p>Hostname cocok dengan daftar izin LinkUMKM. Ini bukan verifikasi pengirim, keamanan, atau tujuan pengalihan. Tinjau pesan sebelum membuka.</p><div className="linkactions">{m.links.map((link,j)=><a className="button primary" key={link} href={link} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Buka tautan LinkUMKM{m.links.length>1?` ${j+1}`:''}<Icon name="arrow"/><span className="sr-only"> (tab baru)</span></a>)}</div><small>Dibuka manual di tab baru. Tidak ada aktivasi otomatis.</small></div>}
                  <div className="messagebody">{m.html?<><span className="bodylabel">TAMPILAN EMAIL · HTML TERISOLASI</span><p className="previewnote">Format pengirim dipertahankan sejauh memungkinkan. Gambar, pelacak, dan tautan di dalam pratinjau dinonaktifkan. Tampilan dapat berbeda dari Gmail.</p><iframe className="emailpreview" title={`Pratinjau email ${i+1}: ${readableText(m.subject)}`} sandbox="" referrerPolicy="no-referrer" srcDoc={m.html}/><details className="textfallback"><summary>Lihat versi teks</summary><pre>{messageText(m.body) || 'Tidak ada versi teks.'}</pre></details></>:<><span className="bodylabel">ISI EMAIL · TEKS SAJA</span><pre>{messageText(m.body) || 'Tidak ada isi teks yang dapat ditampilkan.'}</pre></>}</div>
                </details>):<div className="empty"><Icon name="inbox"/><h3>Belum ada email yang cocok.</h3><p>Pesan harus ditujukan persis ke alias ini. Hanya akun utama dan alias + akun pribadi yang didukung.</p><button onClick={()=>setMailVersion(v=>v+1)}>Periksa kembali</button></div>}
                {limited && <p className="limitnote">Menampilkan hingga 50 hasil pencarian terbaru. Email lain mungkin masih tersedia di Gmail.</p>}
              </div>
              <form className="statusform" onSubmit={submit}><div className="statusintro"><h3>Catat hasil peninjauan</h3><p>Keputusan Anda, bukan hasil otomatis. Status saat ini: <strong>{selected.status || 'Belum diisi'}</strong>.</p></div>{!selected.writable && <p className="alert">Tidak dapat menyimpan: email duplikat atau kolom Status tidak ditemukan.</p>}<fieldset disabled={saving || !selected.writable}><legend>Pilih hasil manual</legend><label className="option success"><input type="radio" name="status" value="BERHASIL" checked={choice==='BERHASIL'} onChange={e=>setChoice(e.target.value)}/><span>BERHASIL<small>Peninjauan berhasil</small></span></label><label className="option failed"><input type="radio" name="status" value="GAGAL" checked={choice==='GAGAL'} onChange={e=>setChoice(e.target.value)}/><span>GAGAL<small>Peninjauan gagal</small></span></label></fieldset><div className="savebar"><p><Icon name="sheet"/>Hanya sel Status email ini yang diubah. Jangan urutkan lembar saat menyimpan.</p><button className="primary" disabled={!choice || saving || !selected.writable}><Icon name="check"/>{saving?'Menyimpan…':'Simpan ke Sheets'}</button></div></form>
            </>}
          </section>
        </div>
        {footer}
      </main>
    </div>
  </div></>;
}
