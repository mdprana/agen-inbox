'use client';
import { useEffect, useState } from 'react';
async function api(path, options) {
  const response = await fetch(path, {cache:'no-store', ...options});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Permintaan gagal.');
  return data;
}
export default function Home() {
  const [session,setSession] = useState(null), [agents,setAgents] = useState([]), [selected,setSelected] = useState(null), [query,setQuery] = useState('');
  const [messages,setMessages] = useState([]), [limited,setLimited] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [loading,setLoading] = useState(false), [mailLoading,setMailLoading] = useState(false), [saving,setSaving] = useState(false), [choice,setChoice] = useState('');
  const [mailVersion,setMailVersion] = useState(0);
  async function loadAgents() {
    setLoading(true); setError('');
    try { const data = await api('/api/agents'); setAgents(data.agents); setSelected(old => old ? data.agents.find(a => a.email === old.email && a.sheet === old.sheet) || null : null); }
    catch(e) { setError(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { api('/api/session').then(s => {setSession(s); if(s.email) loadAgents();}).catch(e => setError(e.message)); }, []);
  useEffect(() => {
    let active = true;
    setMessages([]); setLimited(false); setChoice(''); setNotice('');
    if (!selected) {setMailLoading(false); return;}
    setMailLoading(true); setError('');
    api('/api/inbox?email='+encodeURIComponent(selected.email)).then(data => {if(active) {setMessages(data.messages); setLimited(data.limited);}}).catch(e => {if(active) setError(e.message);}).finally(() => {if(active) setMailLoading(false);});
    return () => {active=false;};
  }, [selected?.email, mailVersion]);
  async function submit(event) {
    event.preventDefault(); if (!selected || !choice || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await api('/api/status', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:selected.email,status:choice})});
      setAgents(rows => rows.map(a => a.email === result.email ? {...a,status:result.status} : a));
      setSelected(a => ({...a,status:result.status})); setNotice('Status '+result.status+' tersimpan di Google Sheets.');
    } catch(e) {setError(e.message);} finally {setSaving(false);}
  }
  async function logout() {
    try {await api('/api/auth/logout',{method:'POST'}); setAgents([]); setMessages([]); setSelected(null); setSession(s => ({...s,email:null})); setError('');} catch(e) {setError(e.message);}
  }
  const filtered = agents.filter(a => (a.name+' '+a.email+' '+a.sheet).toLowerCase().includes(query.toLowerCase()));
  return <main>
    <header className="top"><a className="brand" href="/" aria-label="Agen Inbox, beranda"><span className="mark" aria-hidden="true">AI</span><span>Agen Inbox<small>Ruang kerja pribadi</small></span></a>{session?.email && <div className="account"><span>{session.email}</span><button onClick={logout} disabled={saving}>Keluar</button></div>}</header>
    <section className="intro"><div><p className="eyebrow">INBOX & VERIFIKASI</p><h1>Setiap agen, satu ruang kerja.</h1><p>Baca email alias. Tinjau tautan. Catat hasil secara manual.</p></div><span className="privacy">Pribadi · Google OAuth</span></section>
    {error && <div className="alert" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {!session ? <section className="welcome" aria-live="polite"><h2>Memeriksa sesi…</h2><p>Menyiapkan akses aman ke ruang kerja.</p></section> : !session.configured ? <section className="welcome"><p className="eyebrow">PENYIAPAN DIPERLUKAN</p><h2>Hubungkan Google terlebih dahulu.</h2><p>Data tidak ditampilkan sampai konfigurasi server siap. Tidak ada data contoh.</p><p>Variabel yang perlu diisi:</p><ul>{session.missing.map(m => <li key={m}><code>{m}</code></li>)}</ul><p>Lihat README untuk OAuth dan akses spreadsheet.</p></section> : !session.email ? <section className="welcome"><p className="eyebrow">AKSES TERBATAS</p><h2>Masuk ke inbox pribadi.</h2><p>Hanya <strong>1nd0n3s1aemas@gmail.com</strong> yang dapat mengakses aplikasi ini.</p>{typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('auth') === 'failed' && <p role="alert">Login gagal. Pastikan akun benar dan semua izin Google disetujui.</p>}<a className="primary button" href="/api/auth/login">Masuk dengan Google</a><p className="muted">Aplikasi membaca Gmail. Status Sheets berubah hanya setelah Anda menyimpan.</p></section> : <div className="workspace">
      <aside className="agents"><div className="panelhead"><div><h2>Daftar agen</h2><p>{loading ? 'Memuat spreadsheet…' : `${agents.length} baris dari Google Sheets`}</p></div><button onClick={loadAgents} disabled={loading || saving}>Muat ulang</button></div><label className="search">Cari agen atau email<input type="search" placeholder="Nama, email, atau lembar…" value={query} onChange={e => setQuery(e.target.value)}/></label><div className="agentlist" aria-busy={loading}>{!loading && !filtered.length && <p className="empty">{agents.length ? 'Tidak ada hasil pencarian.' : 'Belum ada agen. Periksa header Email dan Nama Agen di spreadsheet.'}</p>}{filtered.map((a,i) => <button className={'agent '+(selected?.email === a.email && selected?.sheet === a.sheet ? 'selected' : '')} key={a.email+a.sheet+i} onClick={() => setSelected(a)} disabled={saving} aria-pressed={selected?.email === a.email && selected?.sheet === a.sheet}><span className="agentname">{a.name}<span className={'badge '+(a.status === 'BERHASIL' ? 'success' : a.status === 'GAGAL' ? 'failed' : '')}>{a.status || 'Belum diisi'}</span></span><span className="email">{a.email}</span><span className="muted">{a.sheet}{a.duplicate ? ' · Email duplikat' : ''}</span></button>)}</div></aside>
      <section className="detail" aria-label="Detail inbox">{!selected ? <div className="emptydetail"><span className="eyebrow">MULAI DARI DAFTAR AGEN</span><h2>Pilih agen untuk membuka inbox.</h2><p>Email ditampilkan hanya jika penerima cocok persis dengan alias yang dipilih.</p></div> : <><div className="panelhead"><div><p className="eyebrow">INBOX ALIAS</p><h2>{selected.name}</h2><p className="email">{selected.email}</p></div><button disabled={mailLoading || saving} onClick={() => setMailVersion(v => v+1)}>Segarkan inbox</button></div><div className="mail" aria-busy={mailLoading}>{mailLoading ? <p role="status">Memuat email…</p> : messages.length ? messages.map(m => <details key={m.id}><summary><span>{m.subject}</span><small>{new Date(m.date).toLocaleString('id-ID')} · {m.from}</small></summary><pre>{m.body || 'Tidak ada isi teks yang dapat ditampilkan.'}</pre>{m.links.length > 0 && <div className="links"><strong>Tautan LinkUMKM terverifikasi domain</strong><p>Tautan belum diaktifkan atau diverifikasi otomatis. Buka hanya setelah meninjau pesan.</p>{m.links.map(link => <a key={link} href={link} target="_blank" rel="noopener noreferrer">{link}</a>)}</div>}</details>) : <p className="empty">Tidak ada email yang cocok, atau alias ini tidak didukung. Hanya akun utama dan alias + akun pribadi yang diizinkan.</p>}{limited && <p className="muted">Menampilkan hingga 50 hasil pencarian terbaru. Email lain mungkin masih tersedia di Gmail.</p>}</div><form className="statusform" onSubmit={submit}><h3>Catat hasil manual</h3><p>Hanya sel Status milik email ini yang diubah. Jangan urutkan lembar saat penyimpanan berlangsung.</p>{!selected.writable && <p className="alert">Tidak dapat menyimpan: email duplikat atau kolom Status tidak ditemukan.</p>}<fieldset disabled={saving || !selected.writable}><legend>Hasil verifikasi</legend><label className="option"><input type="radio" name="status" value="BERHASIL" checked={choice==='BERHASIL'} onChange={e=>setChoice(e.target.value)}/>BERHASIL</label><label className="option"><input type="radio" name="status" value="GAGAL" checked={choice==='GAGAL'} onChange={e=>setChoice(e.target.value)}/>GAGAL</label></fieldset><button className="primary" disabled={!choice || saving || !selected.writable}>{saving ? 'Menyimpan…' : 'Simpan ke Google Sheets'}</button></form></>}</section>
    </div>}
    <footer>Tidak ada aktivasi tautan otomatis. Data agen tidak disimpan di aplikasi.</footer>
  </main>;
}
