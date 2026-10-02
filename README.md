# Agen Inbox

Private Next.js workspace, Indonesian UI. Reads personal Gmail/plus aliases and every spreadsheet sheet. Manual BERHASIL/GAGAL saves change only one Status cell. No sample agents, imports, automatic verification, or writes during install/build/deploy.

## Run

Node.js 22+, npm. `npm install`, copy `.env.example` to `.env.local`, then `npm run dev`. Production: `npm run build` then `npm start`. `npm test` runs native Node validation tests.

## Google setup

1. Create Google Cloud project. Enable **Gmail API** and **Google Sheets API**.
2. Configure OAuth consent screen, add test user **1nd0n3s1aemas@gmail.com** if app is in testing. Request `openid`, `email`, `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/spreadsheets`. Gmail readonly is restricted; public production may require Google verification. Testing refresh tokens may expire after seven days.
3. Create OAuth client of type **Web application**. Set exact redirect URI `http://localhost:3000/api/auth/callback` locally; production uses `https://YOUR-HOST/api/auth/callback`.
4. Set server-only `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), `APP_URL` (origin only, no path or trailing slash; HTTPS except localhost). Never use `NEXT_PUBLIC_` for secrets or commit `.env.local`. On hosted deployments, add values through deployment secret settings, not source control.
5. Set `SPREADSHEET_ID`, or leave default `1sj0Ax-RvcAYJuKMLQ0DphswKB5hrcylD-uMFeSp2MaI`. Authorized account needs spreadsheet edit permission. No service account required.
6. Start app, sign in with allowed account, grant requested scopes. Other accounts refused. No shared password required.

Credentials absent: app shows setup state; every data endpoint returns 401. Live Google access cannot be verified without real OAuth credentials and consent.

## Spreadsheet contract

Row 1 is header row on each sheet. Required `Email` and agent-name header: `Agent Name`, `Nama Agen`, `Nama Agent`, `Nama`, `Agent`, or `Agen` (case-insensitive; underscores/hyphens normalized). Status header: `Status`, `Status Verifikasi`, or `Verification Status`. Missing Email/name sheets ignored; missing Status makes rows read-only. Blank or invalid email rows skipped. Entire used grid requested through columns A:ZZZ, every sheet, no local persistence.

Email uniqueness checked **across all sheets**, case-insensitive after trimming. Duplicates cannot be saved. Submit re-reads spreadsheet and finds email again, so sorts **before submission** do not reuse stale row numbers. Sheets API lacks compare-and-swap: a concurrent sort/edit between read and write can still race. **Do not sort or restructure sheets during saves.** Add an Apps Script/locked authoritative store if concurrent editing requires transactional guarantees. Values written with `RAW`, only the status cell, never entire row.

## Inbox safety and limits

Only `1nd0n3s1aemas@gmail.com` and `1nd0n3s1aemas+TAG@gmail.com` supported (TAG letters/digits/dot/underscore/hyphen). Gmail query limited to 50 newest search matches, then To/Cc/Delivered-To/X-Original-To parsed and exact alias checked; Gmail fuzzy matching cannot alone authorize a match. No fuzzy Gmail dot/plus equivalence in validation. Messages with stripped recipient headers can be omitted. UI states pagination limit honestly. Attachments not loaded. Plain text MIME preferred; HTML-only fallback stripped to inert text, React escapes content, no raw HTML or remote images. Displayed external links require HTTPS and exact `linkumkm.id` or `www.linkumkm.id` hostname, no credentials/nonstandard port. Domain allowlisting does **not** validate link action or redirect destination; opening is always manual.

## Security

Server-side OAuth authorization-code flow with state and PKCE. Google userinfo validates verified owner email. Access/refresh tokens stored only in AES-256-GCM authenticated-encrypted HttpOnly SameSite=Lax cookie, Secure on HTTPS, seven-day absolute expiry; fresh nonce per cookie write. AES-GCM tag supplies integrity/signing equivalent, no plaintext token storage or browser token exposure. Short-lived state cookie encrypted too. Refresh occurs server-side before Google requests. Logout deletes local session (does not revoke Google consent). Session secret rotation invalidates sessions. Private responses no-store. Data routes require authorized session. POST mutation Origin must equal configured APP_URL; rejects missing/foreign origin. Server API timeouts and generic Google failures avoid leaking tokens. Use HTTPS, protect server environment, no request logging of cookies/tokens.

CSP permits inline scripts/styles for Next runtime; all email content stays text. No analytics, DB, spreadsheet snapshots, or workbook in repository. `.gitignore` excludes environment files and spreadsheet exports.

## Endpoints

- GET `/api/session`: setup state/current owner email only, no tokens.
- GET `/api/auth/login`, GET `/api/auth/callback`: OAuth.
- POST `/api/auth/logout`: same-origin local logout.
- GET `/api/agents`: all agent rows, duplicate/write availability.
- GET `/api/inbox?email=...`: recipient-validated inbox.
- POST `/api/status`: JSON `{ "email": "alias@gmail.com", "status": "BERHASIL" }` (or GAGAL), requires session/origin.

## Verification

`npm test` covers encryption/integrity/expiry, alias validation, exact recipients, LinkUMKM allowlist, MIME safety, sheet parsing/uniqueness and fresh sorted row lookup. `npm run build` checks Next production compilation. After build, `node scripts/smoke.mjs` verifies missing-config HTTP guards; `node scripts/smoke.mjs --configured` uses explicit local test-only configuration to verify OAuth redirect/state cookie and logout Origin checks, without calling Google or fabricating agent data. Real login, Gmail reads, Sheets reads/writes require credentials and are not claimed verified by helper tests. No push or deployment performed.
