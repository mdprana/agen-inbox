import { startOAuth, errorResponse } from '../../../../lib/google.js';
export async function GET() { try { return await startOAuth('connect'); } catch(e) { return errorResponse(e); } }
