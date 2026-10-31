import { startOAuth, errorResponse } from '../../../../lib/google.js';
export async function GET(request) { try { return await startOAuth('login', new URL(request.url).searchParams.get('login_hint')); } catch(e) { return errorResponse(e); } }
