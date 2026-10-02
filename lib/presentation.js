// Presentation only: never changes Gmail content or spreadsheet values.
export function readableText(value = '') {
  const entities = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', copy:'©', reg:'®', ndash:'–', mdash:'—', hellip:'…'};
  return String(value).replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()] ?? whole;
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}
export function messageText(value) {
  // Keep private URL parameters out of visible message previews; opening stays manual.
  return readableText(value).replace(/https?:\/\/[^\s<>"']+/gi, '[Tautan dalam pesan — lihat bagian tautan di bawah]');
}
export function statusGroup(status) {
  return status === 'BERHASIL' ? 'success' : status === 'GAGAL' ? 'failed' : 'pending';
}
export function filterAgents(agents, query, filter) {
  const term = query.trim().toLowerCase();
  return agents.filter(a => (!term || [a.name,a.email,a.sheet].join(' ').toLowerCase().includes(term)) && (filter === 'all' || statusGroup(a.status) === filter));
}
export function displayDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Tanggal tidak tersedia' : date.toLocaleString('id-ID', {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
