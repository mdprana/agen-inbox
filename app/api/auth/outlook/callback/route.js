import { outlookCallback } from '../../../../../lib/outlook.js';
export async function GET(request) { return outlookCallback(request); }
