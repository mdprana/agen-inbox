# Agen Inbox

Private Next.js workspace, Indonesian UI. Team identity, owner Google Sheets and owner-authorized Outlook are independent. Manual BERHASIL/GAGAL saves change one Status cell only. No automatic activation, mail sends, imports, or writes during install/build/deploy. This tree is **not release-ready**; blockers below remain explicit.

## Run and configuration

Node.js 22+, npm, existing dependencies. `npm install`, copy `.env.example` to `.env.local`, supply server secrets privately, then `npm run dev`. Production: `npm run build`, `npm start`. Never commit live env files or use NEXT_PUBLIC secrets. No new paid service is required or authorized.

Server-only variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `APP_URL`, `SPREADSHEET_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `PASSWORD_LOGIN_ENABLED=false`. Redis REST uses `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, or existing `KV_REST_API_URL` / `KV_REST_API_TOKEN` aliases. Use existing approved writable Redis; confirm capacity and atomic EVAL support before release. APP_URL is origin only, HTTPS except localhost. SESSION_SECRET needs at least 32 random characters, supplied through secret settings. Missing/unavailable Redis fails closed for identity and data. Env template contains placeholders only.

Exact source allowlist, no TEAM_EMAILS override or Gmail dot/plus equivalence:
- aprilliawanda13@gmail.com
- ekonduttt@gmail.com
- lintangh9@gmail.com
- madepranajaya01@gmail.com (owner)

Outlook data principal is `ind0n3s1aemas@outlook.com` (letter i), never a team login. Old owner and old member are denied. Changing membership needs reviewed source update and deployment.

## Provider setup

Google Web OAuth: repair/re-enable disabled client or approve replacement; enable Sheets API, configure consent for all four team users. Login requests only `openid email`. Owner Sheets connect requests those plus `https://www.googleapis.com/auth/spreadsheets`, no Gmail scopes. Callback exact `http://localhost:3000/api/auth/callback` locally, APP_URL + `/api/auth/callback` in production. Owner must have edit access to confirmed workbook. Password does not repair `disabled_client` or grant provider access.

Microsoft registration must support personal accounts, confidential Web authorization-code + PKCE, fixed consumers tenant. Delegated scopes only `offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read`. No application, send or write permission. Callback exact `http://localhost:3000/api/auth/outlook/callback` locally, APP_URL + `/api/auth/outlook/callback` in production. Owner separately consents expected mailbox. Graph mail and userPrincipalName must both match; missing/conflicting values fail closed. Graph id pinned on first valid connection; reconnect cannot silently switch it. Consent/secret setup requires separate approval; never paste credentials in chat.

Connections are owner-only same-origin JSON POSTs. **Current J1/J2 endpoint contract returns external HTTP redirects, not JSON authorize URLs. Browser fetch cannot safely read cross-origin manual Location; J4 deliberately reports failure rather than following a credentialed cross-origin POST or fabricating success. Connection initiation is a release blocker requiring separately approved backend contract fix (return validated authorize URL JSON, then top-level navigation).** No GET connect fallback. UI preserves independent readiness, Sheets agents/status when Outlook fails, inline mailbox errors and logout even on setup screens.

## Password enrollment and recovery

Default OFF. UI availability is not production readiness. Once approved/enabled, password identity remains independent of Google configuration and both data connections. No public signup, shared/default password, anonymous bootstrap, auto-enrollment or email service.

Preferred enrollment: existing Google-verified member sets own password within ten minutes of Google login, on same durable user. Minimum 15 Unicode characters, maximum 128 UTF-8 bytes, spaces/paste allowed, never trimmed. Native scrypt parameters remain N=131072,r=8,p=1,maxmem=256 MiB, 64-byte key and random 16-byte salt.

Fallback requires already established recent owner credential and separately approved private delivery. Owner UI can issue invitation or reset for eligible non-owner team account; no automatic delivery. Copy displayed secret link manually only through approved private channel, then clear it. Links use only `/#invite=TOKEN` or `/#reset=TOKEN`; never query/path tokens. Recipient UI removes fragment immediately, keeps token only in ephemeral memory and posts JSON to same-origin credential endpoint. No local/session storage, token logs, analytics or token-link navigation. Refresh loses token; reopen original private link if still valid. Tokens expire in 30 minutes, single use, purpose/user-bound. Enrollment/reset revokes old sessions; sign in again. No owner self-reset; owner recovery needs approved audited operator flow, not chat secrets.

### Password release blockers inherited from J3

1. Real Redis atomic integration UNVERIFIED: mocks do not run Lua or prove EVAL/ZSET/TIME/NX/PX/distributed admission, single consume and revocation. Approved isolated real Redis namespace and test-only credentials required; never production records.
2. Deployment memory/runtime/Redis/free-plan budget unverified. Local single hash ~384 ms, ~191 MiB process peak, ~129 MiB incremental memory; Next baseline plus runtime/concurrency/headroom must fit. Do not weaken scrypt.
3. Global/per-instance admission cap one, ten-minute lease, no renewal or native cancellation. Deployment hard invocation lifetime must be shorter than lease; arbitrarily paused work can overlap after expiry. Lost release fails closed but cannot undo CPU work.
4. Trusted IP only `x-vercel-forwarded-for` with `VERCEL=1`. Verify direct Vercel ingress overwrites/normalizes header and blocks alternate/spoofed ingress; flag alone is not proof. Non-Vercel password routes intentionally unavailable pending reviewed ingress policy.
5. Established owner credential, approved private delivery, enrollment/bootstrap decision and audited owner recovery absent. Google disabled plus no owner credential means enrollment unavailable, never authorization bypass.
6. OFF rejects password sessions, but OFF then ON can revive unexpired records unless authVersion revoked. Permanent disable requires audited durable revoke-all. No bulk revocation/env mutation performed.
7. Local build/smoke are not deployment/browser/provider proof. All credential-dependent gates below remain mandatory. Password stays OFF until every gate approved.

## Spreadsheet and mailbox contract

Row 1 headers: Email plus Agent Name/Nama Agen/Nama Agent/Nama/Agent/Agen; optional Status/Status Verifikasi/Verification Status (case-insensitive, underscores/hyphens normalized). Missing Status means read-only. Every sheet read through A:ZZZ; duplicates across all sheets cannot be saved. Status submit re-reads unique email, RAW one-cell write. Sheets lacks compare-and-swap: **do not sort/restructure/edit concurrently during saves**. Read-to-write sort race remains; no transactional guarantee.

Only lowercase-normalized aliases matching `[a-z0-9._-]+@mdprana.site` with valid length and exactly one current Sheets row may read Outlook. Legacy Gmail rows/statuses remain visible; their inbox is unsupported, never remapped. Inbox + Junk only: at most five pages of 100 candidates per folder, 50 authorized messages, deduped. `limited:true` signals partial scan. Zero means no match in scanned window, not absent from mailbox/history. Other folders and attachments out of scope. Bounded parallelism/timeouts/retries; Graph GET only, no mark-read/send/move/activation requests.

Exact To/Cc address or parsed To/Cc/Delivered-To/X-Original-To header required. Aggregate mailbox, subject/body/display name/From/Return-Path/Received are not evidence. Stripped recipient evidence fails closed. These headers can be forged; selection is not sender provenance or DKIM proof. Real forwarded recipient evidence remains unverified; if another field is needed, stop for redacted evidence/DEV review, do not widen parser speculatively.

HTML preview keeps empty sandbox, CSP before content, no scripts, navigation, forms, remote images/fonts/CID/resources. Inline CSS url() may survive sanitizer but is blocked by preview CSP; browser network gate remains required. React-escaped text fallback retained. Parent manual links only HTTPS exact linkumkm.id, www.linkumkm.id, linkumkm.bri.co.id, no credentials/nonstandard ports. Query tokens preserved without fetch/prefetch/rewrite/analytics; Safe Links wrappers rejected. Links use noopener noreferrer and no-referrer. Host allowlist is not verification of sender, action or redirects. Never click real demo link or call it activated/BERHASIL.

## Security and routes

Opaque random token-free HttpOnly SameSite=Lax session cookie, Secure on HTTPS, seven-day absolute cap. Server Redis session and source allowlist/authVersion rechecked each request; logout deletes session, not provider connections. Old cookies/Redis records never upgraded. Provider records sealed AES-GCM fresh nonce, purpose-separated, absolute cap 180 days, rotated refresh token saved under lock before use. No tokens in general APIs/logs. SESSION_SECRET rotation destroys connection state; not required merely for migration. Preserve private no-store responses and existing security headers.

- GET `/api/session`: identity and independent sheetsReady/outlookReady, safe setup errors, passwordEnabled.
- GET `/api/auth/login`, `/api/auth/callback`: Google identity / Sheets callback.
- POST `/api/auth/connect`, `/api/auth/outlook/connect`: owner-only JSON+Origin initiation; GET Microsoft callback `/api/auth/outlook/callback`.
- POST `/api/auth/password`: login; `/api/auth/password/enroll`: action google/invite; `/api/auth/password/invite`: recent-owner issuance; `/api/auth/password/reset`: action issue/consume.
- POST `/api/auth/logout`: same-origin server logout.
- GET `/api/agents`: identity + Sheets only. GET `/api/inbox?email=...`: identity + unique Sheets alias + Outlook.
- POST `/api/status`: same-origin JSON email/status BERHASIL or GAGAL, identity + Sheets only.

## Verification and release gates

`npm test`; `npm run build`; `node scripts/smoke.mjs`; `node scripts/smoke.mjs --configured`. Native tests use synthetic fetch/Redis/cookie fixtures, retain security regressions, not live integration proof. No lint/typecheck script exists. Run build/smoke only in filesystem-isolated source copy without live .env files/secrets; child env allowlist and explicit empty/test-only provider/Redis/KV/password values prevent inheritance. Next auto-loads env files: environment filtering alone is insufficient. Ports 3108/3109 checked free; stop only own verified child PID/cwd, never broad node/next kills or port 20128.

Browser gate: local production at 1440px and 390px, setup, Google/password disabled/errors, member/owner connection errors, keyboard forms/logout/focus, mobile overflow, synthetic rich-message fixture disconnected from production. Assert zero external preview image/font/activation requests, inert sandbox links. No shipped mock auth bypass and no real activation clicks. Missing browser tooling means BLOCKED, not passed.

Other release blockers: production project/SHA/env/rollback snapshot unknown; Google disabled_client repair and all four real logins/old-member denial unverified; owner Sheets permission/read and independent Outlook read/consent/refresh unverified; actual Graph profile/header/nextLink formats and Cloudflare Inbox/Junk recipient evidence unverified. Status-write integration requires separately approved dedicated test workbook/cell and restoration, never live agent/demo rows. Real Redis capacity/availability/atomic behavior unverified. Demo remains received, NOT ACTIVATED. Historical workbook counts are not current counts.

J5 offline migration tool is not implemented by J4. No migration at app startup/build/deploy. Later alias-only migration requires separate full private backup, current manifest/checksum, exclusive edit freeze, explicit plan/apply approval and drift-aware journal rollback. No live workbook access or writes in coding acceptance. DEV owns commit/push/deploy/env/consent/delivery decisions; no false-green release with blocked gates.
