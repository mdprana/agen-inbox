# Agen Inbox

Private Next.js workspace, Indonesian UI. Reads personal Gmail/plus aliases and every spreadsheet sheet. Manual BERHASIL/GAGAL saves change only one Status cell. No sample agents, imports, automatic verification, or writes during install/build/deploy.

## Run

Node.js 22+, npm. `npm install`, copy `.env.example` to `.env.local`, then `npm run dev`. Production: `npm run build` then `npm start`. `npm test` runs native Node validation tests.

## Google setup

1. Create Google Cloud project. Enable **Gmail API** and **Google Sheets API**.
2. Configure OAuth consent screen, add test users **1nd0n3s1aemas@gmail.com** and **jderchild@gmail.com** if app is in testing. Login requests only `openid email`; separate owner connect requests Gmail/Sheets permissions. Request `openid`, `email`, `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/spreadsheets`. Gmail readonly is restricted; public production may require Google verification. Testing refresh tokens may expire after seven days.
3. Create OAuth client of type **Web application**. Set exact redirect URI `http://localhost:3000/api/auth/callback` locally; production uses `https://YOUR-HOST/api/auth/callback`.
4. Set server-only `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), `APP_URL` (origin only, no path or trailing slash; HTTPS except localhost). Never use `NEXT_PUBLIC_` for secrets or commit `.env.local`. On hosted deployments, add values through deployment secret settings, not source control.
5. Set `SPREADSHEET_ID`, or leave default `1sj0Ax-RvcAYJuKMLQ0DphswKB5hrcylD-uMFeSp2MaI`. Authorized account needs spreadsheet edit permission. No service account required.
6. Create an Upstash Redis database. Set server-only `UPSTASH_REDIS_REST_URL` (HTTPS REST endpoint) and `UPSTASH_REDIS_REST_TOKEN` (read/write REST token). No Redis SDK required. Missing/unavailable storage blocks data access; login identity still works.
7. `TEAM_EMAILS` is a comma-separated exact email allowlist; unset defaults to `jderchild@gmail.com`. Set empty to revoke all members; owner `1nd0n3s1aemas@gmail.com` remains allowed. No Gmail dot/plus alias equivalence. Allowlist checked on every authenticated request; deploy changed environment to revoke existing sessions immediately on next request.
8. Owner signs in, then clicks **Hubungkan Gmail & Sheets**. Only owner can authorize shared connection. Members sign in with identity permissions only; member mailbox tokens never authorize Gmail/Sheets. Logout removes user identity cookie, not shared connection. No shared password.
9. Testing refresh tokens can expire after seven days. Owner must reconnect when connection fails. Existing encrypted legacy owner cookie can migrate server-side on authenticated data/session request when storage exists; its old absolute expiry is retained. Migration rechecks verified owner userinfo and keeps actual Google subject; member token cookies cannot migrate.

Credentials absent: app shows setup state; every data endpoint returns 401. Live Google access cannot be verified without real OAuth credentials and consent.

## Spreadsheet contract

Row 1 is header row on each sheet. Required `Email` and agent-name header: `Agent Name`, `Nama Agen`, `Nama Agent`, `Nama`, `Agent`, or `Agen` (case-insensitive; underscores/hyphens normalized). Status header: `Status`, `Status Verifikasi`, or `Verification Status`. Missing Email/name sheets ignored; missing Status makes rows read-only. Blank or invalid email rows skipped. Entire used grid requested through columns A:ZZZ, every sheet, no local persistence.

Email uniqueness checked **across all sheets**, case-insensitive after trimming. Duplicates cannot be saved. Submit re-reads spreadsheet and finds email again, so sorts **before submission** do not reuse stale row numbers. Sheets API lacks compare-and-swap: a concurrent sort/edit between read and write can still race. **Do not sort or restructure sheets during saves.** Add an Apps Script/locked authoritative store if concurrent editing requires transactional guarantees. Values written with `RAW`, only the status cell, never entire row.

## Inbox safety and limits

Only `1nd0n3s1aemas@gmail.com` and `1nd0n3s1aemas+TAG@gmail.com` supported (TAG letters/digits/dot/underscore/hyphen). Gmail query limited to 50 newest search matches, then To/Cc/Delivered-To/X-Original-To parsed and exact alias checked; Gmail fuzzy matching cannot alone authorize a match. No fuzzy Gmail dot/plus equivalence in validation. Messages with stripped recipient headers can be omitted. UI states pagination limit honestly. Attachments not loaded. HTML MIME is retained alongside plain text fallback, excluding named/disposition attachments and their subtrees. `sanitize-html` removes scripts, forms, metadata refresh, resource elements, event handlers and all navigation/resource attributes. Preview uses an opaque-origin iframe with empty `sandbox` (no scripts, same-origin, popups, forms or top navigation). Its srcDoc starts with a restrictive CSP (`default-src 'none'`, inline styles only, no images/fonts/connections/frames, `base-uri 'none'`, `form-action 'none'`). Sender tables, typography, colors and inline/style-block layout are retained; links inside preview have no href/target and cannot activate. Images, CID attachments and remote tracking are not loaded. Visible raw URLs are replaced with descriptive placeholders; validated links stay in the parent manual-action panel. Exact Gmail appearance is not promised: blocked images/fonts and Gmail-specific processing differ. Plain text remains available and React-escaped. Displayed external links require HTTPS and exact `linkumkm.id`, `www.linkumkm.id` or `linkumkm.bri.co.id` hostname, no credentials/nonstandard port. Domain allowlisting does **not** validate link action or redirect destination; opening is always manual.

## Security

Server-side OAuth authorization-code flow with encrypted state and PKCE, bound to login/connect mode; connect additionally bound to authenticated owner subject. Google userinfo validates verified exact allowlisted email. Seven-day HttpOnly SameSite=Lax identity cookie contains no OAuth tokens, Secure on HTTPS. Shared owner access/refresh tokens stored server-side in Upstash Redis, AES-256-GCM encrypted with SESSION_SECRET and fresh nonce per write; Redis SET has expiry, sealed record has absolute expiry capped at 180 days (shorter when Google specifies refresh-token expiry). Expired, missing, tampered or non-owner records fail closed. Refresh occurs server-side before Google requests; API/session responses never expose tokens. Logout deletes local identity only. SESSION_SECRET rotation invalidates identity cookies and shared connection, requiring owner reconnection. Short-lived state cookie encrypted too. Private responses no-store. Data routes require authorized session. POST mutation Origin must equal configured APP_URL; rejects missing/foreign origin. Server API timeouts and generic Google failures avoid leaking tokens. Use HTTPS, protect server environment, no request logging of cookies/tokens.

Parent CSP permits inline scripts/styles for Next runtime; HTML email content stays in a separate no-script, opaque-origin sandbox with stricter srcDoc CSP. No analytics, spreadsheet snapshots, or workbook in repository. Redis stores only encrypted shared OAuth connection, not agent data. `.gitignore` excludes environment files and spreadsheet exports.

## Endpoints

- GET `/api/session`: setup state/current allowed identity and shared-ready status only, no tokens.
- GET `/api/auth/login`, GET `/api/auth/callback`: OAuth.
- GET `/api/auth/connect`: authenticated owner-only Gmail/Sheets authorization.
- POST `/api/auth/logout`: same-origin local logout.
- GET `/api/agents`: all agent rows, duplicate/write availability.
- GET `/api/inbox?email=...`: recipient-validated inbox.
- POST `/api/status`: JSON `{ "email": "alias@gmail.com", "status": "BERHASIL" }` (or GAGAL), requires session/origin.

## Verification

`npm test` covers exact verified team identity, immediate allowlist revocation, owner-only connect/mode/PKCE binding, encrypted Redis storage via native-fetch mocks, absent/expired connection, refresh failures, plus encryption/integrity/expiry, alias validation, exact recipients, LinkUMKM allowlist, MIME safety, sheet parsing/uniqueness and fresh sorted row lookup. `npm run build` checks Next production compilation. After build, `node scripts/smoke.mjs` verifies missing-config HTTP guards; `node scripts/smoke.mjs --configured` uses explicit local test-only configuration to verify OAuth redirect/state cookie and logout Origin checks, without calling Google or fabricating agent data. Real login, Gmail reads, Sheets reads/writes require credentials and are not claimed verified by helper tests. No push or deployment performed.
