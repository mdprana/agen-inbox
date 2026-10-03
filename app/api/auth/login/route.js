import { startOAuth, errorResponse } from '../../../../lib/google.js';
export async function GET() { try { return await startOAuth('login'); } catch(e) { return errorResponse(e); } }
