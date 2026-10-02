'use client';

import { useEffect, useRef, useState } from 'react';
import { displayDate, filterAgents, messageText, readableText, statusGroup } from '../lib/presentation.js';

const ICON_PATHS = {
  inbox: 'M4 4h16v16H4z M4 13h5l2 3h2l2-3h5',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-2l2 3 M4 16l2 3a7 7 0 0 0 12-2',
  copy: 'M9 9h11v11H9z M15 5V3H3v12h2',
  arrow: 'M7 17 17 7 M7 7h10v10',
  back: 'M19 12H5 M11 6l-6 6 6 6',
  shield: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z M8 12l3 3 5-6',
  check: 'M5 12l4 4L19 6',
  sheet: 'M5 3h14v18H5z M5 9h14 M5 15h14 M12 9v12',
  exit: 'M9 4H4v16h5 M10 12h11 M17 8l4 4-4 4',
  lock: 'M6 11h12v10H6z M8 11V8a4 4 0 0 1 8 0v3',
};

function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name] || ICON_PATHS.inbox} />
    </svg>
  );
}

function Status({ status }) {
  return <span className={'status ' + statusGroup(status)}>{status || 'belum diisi'}</span>;
}

// Show the destination host, never a token-bearing URL.
function linkHost(link) {
  try { return new URL(link).host; } catch { return 'tautan'; }
}

async function api(path, options) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Permintaan gagal.');
  return data;
}

const FILTERS = [
  ['all', 'Semua'],
  ['pending', 'Belum diisi'],
  ['success', 'Berhasil'],
  ['failed', 'Gagal'],
];

export default function Home() {
  const [session, setSession] = useState(null);
  const [agents, setAgents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [choice, setChoice] = useState('');
  const [limited, setLimited] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copyState, setCopyState] = useState('');
  const [loading, setLoading] = useState(false);
  const [mailLoading, setMailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mailVersion, setMailVersion] = useState(0);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [sessionFailed, setSessionFailed] = useState(false);
  const [mailFailed, setMailFailed] = useState(false);
  const detailHeading = useRef(null);
  const searchInput = useRef(null);

  async function loadAgents() {
    setLoading(true);
    setError('');
    try {
      const data = await api('/api/agents');
      setAgents(data.agents);
      setSelected(old => (old ? data.agents.find(a => a.email === old.email && a.sheet === old.sheet) || null : null));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadSession() {
    setSessionFailed(false);
    setError('');
    try {
      const data = await api('/api/session');
      setSession(data);
      if (data.email) loadAgents();
    } catch (e) {
      setError(e.message);
      setSessionFailed(true);
    }
  }

  useEffect(() => { loadSession(); }, []);

  useEffect(() => {
    let active = true;
    setMessages([]);
    setLimited(false);
    setChoice('');
    setNotice('');
    setCopyState('');
    setMailFailed(false);
    if (!selected) {
      setMailLoading(false);
      return;
    }
    setMailLoading(true);
    setError('');
    api('/api/inbox?email=' + encodeURIComponent(selected.email))
      .then(data => { if (active) { setMessages(data.messages); setLimited(data.limited); } })
      .catch(e => { if (active) { setError(e.message); setMailFailed(true); } })
      .finally(() => { if (active) setMailLoading(false); });
    return () => { active = false; };
  }, [selected?.email, mailVersion]);

  useEffect(() => {
    if (mobileDetail) detailHeading.current?.focus();
  }, [mobileDetail, selected?.email, selected?.sheet]);

  async function submit(event) {
    event.preventDefault();
    if (!selected || !choice || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await api('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: selected.email, status: choice }),
      });
      setAgents(rows => rows.map(a => (a.email === result.email ? { ...a, status: result.status } : a)));
      setSelected(a => ({ ...a, status: result.status }));
      setNotice('Status ' + result.status + ' tersimpan di Google Sheets.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      setAgents([]);
      setMessages([]);
      setSelected(null);
      setSession(s => ({ ...s, email: null }));
      setError('');
      setNotice('');
      setCopyState('');
    } catch (e) {
      setError(e.message);
    }
  }

  async function copyAlias() {
    try {
      await navigator.clipboard.writeText(selected.email);
      setCopyState('Alias disalin.');
    } catch {
      setCopyState('Tidak dapat menyalin. Pilih teks alias lalu salin manual.');
    }
  }

  const filtered = filterAgents(agents, query, filter);
  const counts = {
    all: agents.length,
    pending: agents.filter(a => statusGroup(a.status) === 'pending').length,
    success: agents.filter(a => statusGroup(a.status) === 'success').length,
    failed: agents.filter(a => statusGroup(a.status) === 'failed').length,
  };
  const authFailed = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('auth') === 'failed';

  return (
    <>
      <a href="#content" className="skip">Lewati ke konten</a>

      <header className="topbar">
        <div className="shell topbar-inner">
          <a className="brand" href="/" aria-label="Agen Inbox">
            <img src="/icon.svg" alt="" width="34" height="34" />
            <span className="brand-name">Agen Inbox</span>
            <span className="brand-note">Workspace pribadi</span>
          </a>
          {session?.email ? (
            <div className="account">
              <span className="account-email"><b>{session.email}</b><small>Akun terhubung</small></span>
              <button type="button" onClick={logout} disabled={saving}><Icon name="exit" />Keluar</button>
            </div>
          ) : (
            <span className="privacy"><Icon name="lock" />Akses khusus pemilik</span>
          )}
        </div>
      </header>

      <main id="content" className="shell">
        {error && <p className="alert" role="alert"><b>Permintaan belum selesai.</b> {error}</p>}
        <div role="status" aria-live="polite" className={notice ? 'notice' : 'sr-only'}>{notice}</div>

        {!session ? (
          <section className="gate" aria-busy={!sessionFailed}>
            <h1>{sessionFailed ? 'Sesi belum dapat dimuat' : 'Membuka ruang kerja'}</h1>
            {sessionFailed ? (
              <>
                <p>Periksa koneksi, lalu coba lagi.</p>
                <button type="button" onClick={loadSession}>Coba lagi</button>
              </>
            ) : (
              <div className="skeleton" aria-hidden="true"><span /><span /><span className="short" /></div>
            )}
          </section>
        ) : !session.configured ? (
          <section className="gate">
            <h1>Konfigurasi server belum lengkap</h1>
            <p>Gmail dan Sheets tidak ditampilkan sampai seluruh variabel diisi. Tidak ada data contoh di aplikasi ini.</p>
            <ul className="config-list">{session.missing.map(m => <li key={m}><code>{m}</code></li>)}</ul>
            <p className="fine">Langkah lengkap ada di README repositori.</p>
          </section>
        ) : !session.email ? (
          <section className="gate">
            <h1>Masuk untuk mulai meninjau</h1>
            <p>Aplikasi ini membaca inbox alias lewat Gmail API dan menulis satu sel Status di spreadsheet yang Anda pilih. Tidak ada aktivitas lain yang berjalan di latar belakang.</p>
            <dl className="facts">
              <div><dt>Dibaca</dt><dd>Pesan yang ditujukan persis ke alias pilihan</dd></div>
              <div><dt>Ditulis</dt><dd>Sel Status pada baris agen, saat Anda menekan simpan</dd></div>
              <div><dt>Tidak dilakukan</dt><dd>Membuka atau mengaktifkan tautan secara otomatis</dd></div>
            </dl>
            {authFailed && <p className="alert" role="alert">Login gagal. Pakai akun pemilik dan setujui seluruh izin Google.</p>}
            <a className="button solid" href="/api/auth/login"><span className="gl" aria-hidden="true">G</span>Masuk dengan Google<Icon name="arrow" /></a>
          </section>
        ) : (
          <>
            <section className="toolbar" aria-label="Daftar agen">
              <div className="toolbar-row">
                <label className="field" htmlFor="agent-search">
                  <span>Cari agen</span>
                  <span className="field-input">
                    <Icon name="search" />
                    <input ref={searchInput} id="agent-search" name="agent-search" type="search" autoComplete="off" placeholder="Nama, email, atau lembar" value={query} onChange={e => setQuery(e.target.value)} />
                  </span>
                </label>
                <div className="segments" role="group" aria-label="Filter status">
                  {FILTERS.map(([value, label]) => (
                    <button key={value} type="button" onClick={() => { setFilter(value); setMobileDetail(false); }} aria-pressed={filter === value}>
                      {label}<span>{loading ? '·' : counts[value]}</span>
                    </button>
                  ))}
                </div>
                <button type="button" className="icon-button" onClick={loadAgents} disabled={loading || saving} aria-label="Muat ulang daftar agen"><Icon name="refresh" /></button>
              </div>
              <p className="tally" role="status">
                {loading ? 'Memuat spreadsheet…' : `${filtered.length} dari ${agents.length} baris`}
                <span>Sumber: Google Sheets</span>
              </p>
            </section>

            <div className={'workspace ' + (mobileDetail ? 'show-detail' : 'show-list')}>
              <aside className="list" aria-label="Daftar agen">
                {loading && (
                  <div className="skeleton" aria-hidden="true"><span /><span /><span /><span className="short" /></div>
                )}
                {!loading && !filtered.length && (
                  <div className="blank">
                    <h2>{agents.length ? 'Tidak ada baris yang cocok' : 'Belum ada baris agen'}</h2>
                    <p>{agents.length ? 'Ubah kata kunci atau tampilkan semua status.' : 'Pastikan header Email dan Nama Agen terisi di spreadsheet.'}</p>
                    {agents.length > 0 && <button type="button" onClick={() => { setQuery(''); setFilter('all'); }}>Reset pencarian</button>}
                  </div>
                )}
                <ol className="rows">
                  {filtered.map((a, i) => {
                    const active = selected?.email === a.email && selected?.sheet === a.sheet;
                    return (
                      <li key={a.email + a.sheet + i}>
                        <button type="button" className={'row' + (active ? ' is-active' : '')} onClick={() => { setSelected(a); setMobileDetail(true); }} disabled={saving} aria-pressed={active}>
                          <span className="row-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                          <span className="row-main">
                            <span className="row-name">{a.name || 'Tanpa nama'}</span>
                            <span className="mono">{a.email}</span>
                          </span>
                          <span className="row-meta">
                            <span className="sheet-tag">{a.sheet}</span>
                            <Status status={a.status} />
                            {a.duplicate && <span className="dup">duplikat</span>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </aside>

              <section className="detail" aria-label="Detail inbox">
                <button type="button" className="back" disabled={saving} onClick={() => { setMobileDetail(false); requestAnimationFrame(() => searchInput.current?.focus()); }}><Icon name="back" />Kembali ke daftar</button>

                {!selected ? (
                  <div className="blank tall">
                    <h2>Belum ada agen dipilih</h2>
                    <p>Pilih baris di sebelah kiri untuk membaca inbox alias-nya, lalu catat hasil peninjauan.</p>
                    <p className="fine"><Icon name="lock" />Pesan hanya muncul jika penerimanya persis sama dengan alias yang dipilih.</p>
                  </div>
                ) : (
                  <>
                    <div className="detail-head">
                      <div>
                        <h2 ref={detailHeading} tabIndex={-1}>{selected.name || 'Tanpa nama'}</h2>
                        <div className="alias">
                          <span className="mono">{selected.email}</span>
                          <button type="button" className="ghost" onClick={copyAlias} aria-label="Salin alias email">
                            <Icon name="copy" />{copyState === 'Alias disalin.' ? 'Disalin' : 'Salin'}
                          </button>
                        </div>
                        <div role="status" className={copyState ? 'fine' : 'sr-only'}>{copyState}</div>
                      </div>
                      <div className="detail-tools">
                        <Status status={selected.status} />
                        <button type="button" onClick={() => setMailVersion(v => v + 1)} disabled={mailLoading || saving}><Icon name="refresh" />Segarkan</button>
                      </div>
                    </div>

                    <div className="mail-head">
                      <h3>Pesan masuk</h3>
                      <span>{mailLoading ? 'memuat…' : `${messages.length} pesan`}</span>
                    </div>

                    <div className="mail" aria-busy={mailLoading}>
                      {mailLoading ? (
                        <div className="skeleton" aria-hidden="true"><span /><span className="short" /></div>
                      ) : mailFailed ? (
                        <div className="blank">
                          <h2>Inbox belum dapat dimuat</h2>
                          <p>Periksa koneksi atau izin Gmail, lalu segarkan kembali.</p>
                          <button type="button" onClick={() => setMailVersion(v => v + 1)}>Coba lagi</button>
                        </div>
                      ) : messages.length ? (
                        messages.map((m, i) => (
                          <details key={m.id} className="message" open={i === 0}>
                            <summary>
                              <span className="row-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                              <span className="message-title">
                                {readableText(m.subject)}
                                <small>{displayDate(m.date)} · {readableText(m.from)}</small>
                              </span>
                            </summary>

                            {m.links.length > 0 && (
                              <div className="links">
                                <h4>Tautan hostname diizinkan — buka manual</h4>
                                <p>Hostname cocok dengan daftar izin LinkUMKM. Bukan verifikasi pengirim, keamanan, atau tujuan pengalihan. Tinjau pesan sebelum membuka.</p>
                                <div className="link-row">
                                  {m.links.map((link, j) => (
                                    <a className="button solid" key={link} href={link} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                                      Buka {linkHost(link)}<Icon name="arrow" />
                                      <span className="sr-only"> (tab baru)</span>
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="message-body">
                              {m.html ? (
                                <>
                                  <p className="body-label">Tampilan asli pengirim · HTML diisolasi</p>
                                  <p className="fine">Gambar, pelacak, dan tautan di dalam pratinjau dimatikan. Tampilan bisa sedikit berbeda dari Gmail.</p>
                                  <iframe className="preview" title={`Pratinjau email ${i + 1}: ${readableText(m.subject)}`} sandbox="" referrerPolicy="no-referrer" srcDoc={m.html} />
                                  <details className="text-toggle">
                                    <summary>Versi teks</summary>
                                    <pre>{messageText(m.body) || 'Tidak ada versi teks.'}</pre>
                                  </details>
                                </>
                              ) : (
                                <>
                                  <p className="body-label">Isi email · teks saja</p>
                                  <pre>{messageText(m.body) || 'Tidak ada isi teks yang dapat ditampilkan.'}</pre>
                                </>
                              )}
                            </div>
                          </details>
                        ))
                      ) : (
                        <div className="blank">
                          <h2>Belum ada email yang cocok</h2>
                          <p>Pesan harus ditujukan persis ke alias ini.</p>
                          <button type="button" onClick={() => setMailVersion(v => v + 1)}>Periksa kembali</button>
                        </div>
                      )}
                      {limited && <p className="fine">Menampilkan hingga 50 hasil terbaru. Email lain mungkin masih ada di Gmail.</p>}
                    </div>

                    <form className="status-form" onSubmit={submit}>
                      <div className="status-head">
                        <h3>Catat hasil peninjauan</h3>
                        <p>Keputusan Anda. Status sekarang: <b>{selected.status || 'belum diisi'}</b>.</p>
                      </div>
                      {!selected.writable && <p className="alert">Tidak dapat menyimpan: email duplikat atau kolom Status tidak ditemukan.</p>}
                      <fieldset disabled={saving || !selected.writable}>
                        <legend>Pilih hasil</legend>
                        <label className="choice ok">
                          <input type="radio" name="status" value="BERHASIL" checked={choice === 'BERHASIL'} onChange={e => setChoice(e.target.value)} />
                          <span><b>BERHASIL</b><small>Peninjauan berhasil</small></span>
                        </label>
                        <label className="choice no">
                          <input type="radio" name="status" value="GAGAL" checked={choice === 'GAGAL'} onChange={e => setChoice(e.target.value)} />
                          <span><b>GAGAL</b><small>Peninjauan gagal</small></span>
                        </label>
                      </fieldset>
                      <div className="save-row">
                        <p className="fine"><Icon name="sheet" />Hanya sel Status baris ini yang berubah. Jangan mengurutkan lembar saat menyimpan.</p>
                        <button type="submit" className="solid" disabled={!choice || saving || !selected.writable}>
                          <Icon name="check" />{saving ? 'Menyimpan…' : 'Simpan ke Sheets'}
                        </button>
                      </div>
                    </form>
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </main>

      <footer className="shell">
        <span>Agen Inbox · {new Date().getFullYear()}</span>
        <span>Tidak ada aktivasi otomatis · data agen tidak disimpan di aplikasi</span>
      </footer>
    </>
  );
}
