import { requireSession, writeStatus, checkOrigin, errorResponse } from '../../../lib/google.js';
export async function POST(request) {
  try {
    const session = await requireSession(); checkOrigin(request);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('Gunakan JSON.');
    if (Number(request.headers.get('content-length')) > 4096) throw new Error('Permintaan terlalu besar.');
    const text = await request.text(); if (text.length > 4096) throw new Error('Permintaan terlalu besar.');
    const {email, status} = JSON.parse(text);
    if (typeof email !== 'string' || typeof status !== 'string') throw new Error('Email dan status wajib diisi.');
    return Response.json(await writeStatus(session,email,status), {headers:{'Cache-Control':'no-store'}});
  } catch(e) { return errorResponse(e); }
}
