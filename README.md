# Agen Inbox

Private Next.js workspace, Indonesian UI. Team identity, owner Google Sheets and the Cloudflare Email Worker mail source are independent. Manual BERHASIL/GAGAL saves change one Status cell only. No automatic activation, mail sends, imports, or writes during install/build/deploy. This tree is **not release-ready**; blockers below remain explicit.

## Run and configuration

Node.js 22+, npm, existing dependencies. `npm install`, copy `.env.example` to `.env.local`, supply server secrets privately, then `npm run dev`. Production: `npm run build`, `npm start`. Never commit live env files or use NEXT_PUBLIC secrets. No new paid service is required or authorized.

Server-only variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `APP_URL`, `SPREADSHEET_ID`, `MAIL_WORKER_URL` (Worker HTTPS origin, no path/query/credentials), `MAIL_WORKER_TOKEN` (same value as Worker `READ_TOKEN`), `PASSWORD_LOGIN_ENABLED=false`. Redis REST uses `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, or existing `KV_REST_API_URL` / `KV_REST_API_TOKEN` aliases. Use existing approved writable Redis; confirm capacity and atomic EVAL support before release. APP_URL is origin only, HTTPS except localhost. SESSION_SECRET needs at least 32 random characters, supplied through secret settings. Missing/unavailable Redis fails closed for identity and data. Env template contains placeholders only.

Exact source allowlist, no TEAM_EMAILS override or Gmail dot/plus equivalence:
- aprilliawanda13@gmail.com
- ekonduttt@gmail.com
- lintangh9@gmail.com
- madepranajaya01@gmail.com (owner)

Mail mailbox `ind0n3s1aemas@outlook.com` (letter i) is the required production forward backup, never a team login. Old owner and old member are denied. Changing membership needs reviewed source update and deployment.

## Provider setup

Google Web OAuth: repair/re-enable disabled client or approve replacement; enable Sheets API, configure consent for all four team users. Login requests only `openid email`. Owner Sheets connect requests those plus `https://www.googleapis.com/auth/spreadsheets`, no Gmail scopes. Callback exact `http://localhost:3000/api/auth/callback` locally, APP_URL + `/api/auth/callback` in production. Owner must have edit access to confirmed workbook. Password does not repair `disabled_client` or grant provider access.
Connections are owner-only same-origin JSON POSTs. **Current J1/J2 endpoint contract returns external HTTP redirects, not JSON authorize URLs. Browser fetch cannot safely read cross-origin manual Location; J4 deliberately reports failure rather than following a credentialed cross-origin POST or fabricating success. Connection initiation is a release blocker requiring separately approved backend contract fix (return validated authorize URL JSON, then top-level navigation).** No GET connect fallback. UI preserves independent readiness, Sheets agents/status when mail source fails, inline mailbox errors and logout even on setup screens.

## Cloudflare Email Worker

Microsoft blocks app registration for personal accounts, so mail no longer comes from Outlook/Graph. `*@mdprana.site` reaches Cloudflare Email Routing; `worker/` (separate deploy unit) stores each message for valid aliases in Workers KV (30-day TTL, max 1 MB raw) and serves `GET /messages?alias=` with `Authorization: Bearer READ_TOKEN` (constant-time compare, newest 50, no-store). Site reads only through that endpoint.

Deploy (separately approved, from `worker/`):
1. `npm install` then `npx wrangler kv namespace create MAIL`; put returned id in `wrangler.toml` (replace `REPLACE_WITH_KV_ID`).
2. `npx wrangler secret put READ_TOKEN` (random, at least 32 chars). Same value goes to site `MAIL_WORKER_TOKEN`.
3. **Required for production:** `npx wrangler secret put FORWARD_TO` with `ind0n3s1aemas@outlook.com`, the already verified Email Routing destination. Do not enable production routing without this backup. Storage-only operation without forwarding is for tests only. Parsing/storage failure still attempts forwarding; forwarding failure still preserves successful storage. If neither succeeds, Worker rejects with `Temporary storage failure; please retry` rather than silently accepting lost mail.
4. `npx wrangler deploy`; set site `MAIL_WORKER_URL` to Worker origin (e.g. `https://agen-inbox-mail.<account>.workers.dev`).
5. Email Routing for mdprana.site: catch-all action "Send to a Worker" → `agen-inbox-mail`.

Rollback: Email Routing catch-all action back to "Send to an email" → Outlook mailbox. Stored KV mail stays readable until TTL; clearing `MAIL_WORKER_URL` makes inbox report not-ready. Previous Outlook/Graph code exists only in git history (commit 2af2cca).

Only mail received after Worker routing is active is visible; existing Outlook history is NOT imported. Stored mail expires after 30 days. Raw messages larger than 1 MB (1,048,576 bytes), including MIME overhead and attachments, are rejected before storage or forwarding: no Outlook backup copy is created for those rejected messages. Attachments are not stored or displayed; only parsed plain text and HTML are retained (each capped at 100,000 characters).

Workers KV is eventually consistent: newly received mail may take up to 60 seconds or more to appear, including after a previously empty read; an empty inbox does not prove no mail arrived. Free-plan quotas are 1,000 list requests/day, 1,000 writes/day, 100,000 reads/day and 1 GB storage. Each inbox request uses one list plus up to 50 reads; each stored message uses one write. Quotas are shared account usage, reset at 00:00 UTC, and exceeding a daily operation limit makes that operation fail. No zero-cost guarantee at arbitrary volume; monitor usage and approve any paid upgrade separately. Verified against [Cloudflare KV pricing](https://developers.cloudflare.com/kv/platform/pricing/), [limits](https://developers.cloudflare.com/kv/platform/limits/) and [consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

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

Only lowercase-normalized aliases matching `[a-z0-9._-]+@mdprana.site` with valid length and exactly one current Sheets row may read mail. Legacy Gmail rows/statuses remain visible; their inbox is unsupported, never remapped. Worker keys mail by envelope recipient (`message.to`), so alias match is exact routing evidence, not header parsing. Newest 50 per alias; `limited:true` means older stored mail exists. Zero can mean no stored mail since Worker activation, expired 30-day TTL, or delayed KV visibility. Attachments out of scope. Site performs one bounded GET (15 s timeout); no send/mark-read/activation requests.

Envelope recipient selection is not sender provenance or DKIM proof.

HTML preview keeps empty sandbox, CSP before content, no scripts, navigation, forms, remote images/fonts/CID/resources. Inline CSS url() may survive sanitizer but is blocked by preview CSP; browser network gate remains required. React-escaped text fallback retained. Parent manual links only HTTPS exact linkumkm.id, www.linkumkm.id, linkumkm.bri.co.id, no credentials/nonstandard ports. Query tokens preserved without fetch/prefetch/rewrite/analytics; Safe Links wrappers rejected. Links use noopener noreferrer and no-referrer. Host allowlist is not verification of sender, action or redirects. Never click real demo link or call it activated/BERHASIL.

## J13 migration: read-only only

Owner Pengaturan → Simulasikan migrasi uses shared Sheets connection, not mail readiness. POST `/api/migration` accepts only `{ "action": "plan" }` for execution, same-origin JSON, current owner/session/allowlist/connection required. One full `spreadsheets.get?includeGridData=true` GET with no field mask captures workbook/grid metadata and all returned CellData, including hidden sheets, formats, notes, validation, merges, protections and named ranges. No A:ZZZ truncation. Unsupported non-GRID sheets, malformed dimensions, more than 5,000,000 allocated grid cells, response/attachment above 8 MiB or 20-second fetch failure stop without partial output. These are local read-only ceilings, not verified deployment capacity. Snapshot is API grid backup, not Drive clone/history or proof against concurrent external edits.

Response is private no-store JSON attachment containing snapshot, SHA-256 of serialized snapshot and aggregate plan. Browser verifies both snapshot and whole attachment hashes, keeps original blob only in tab memory, and downloads that exact blob without refetching. Workbook identity appears only to owner. No snapshot/manifest/PII stored in Redis, deployment disk, public tree or browser storage. Reload, logout or pagehide discards blob. No durable/session-bound plan, opaque plan ID, server acknowledgement or resume supported; a new simulation is a new read. Do not treat local checkbox as server confirmation or proof of saved file.

Owner must save outside repo/public cloud in private folder (Linux directory 0700/file 0600 or equivalent OS ACL), then compare file SHA-256 with UI (`sha256sum /private/path/migration-backup.json`). Keep backup until DEV review complete. Never attach backup to task board/git. Review real aggregate counts and workbook identity before any future approval. No live simulation/backup claimed by synthetic tests.

`apply` always returns server 409, regardless of checkbox/conflicts; `backup`, `confirm-backup`, `report` return 409 because no server plan exists. Capacity and hard invocation ceiling remain UNVERIFIED. DEV must verify provider request/item/storage/runtime limits and approve durable private session-bound storage, backup acknowledgement, freeze, cooperative status lock, per-cell drift/collision checks, write-intent journal/reconciliation and final full-grid verification before a separately reviewed writer exists. No migration writes, status lock, activation, mail or automatic rollback implemented. Recovery now means no migration changes to undo; future operator recovery must use reviewed private journal and restore only verified Email cells, never blanket-import this snapshot.

## Security and routes

Opaque random token-free HttpOnly SameSite=Lax session cookie, Secure on HTTPS, seven-day absolute cap. Server Redis session and source allowlist/authVersion rechecked each request; logout deletes session, not provider connections. Old cookies/Redis records never upgraded. Provider records sealed AES-GCM fresh nonce, purpose-separated, absolute cap 180 days, rotated refresh token saved under lock before use. No tokens in general APIs/logs. SESSION_SECRET rotation destroys connection state; not required merely for migration. Preserve private no-store responses and existing security headers.

- GET `/api/session`: identity and independent sheetsReady/mailReady, safe setup errors, passwordEnabled.
- GET `/api/auth/login`, `/api/auth/callback`: Google identity / Sheets callback.
- POST `/api/auth/connect`: owner-only JSON+Origin Sheets initiation.
- POST `/api/auth/password`: login; `/api/auth/password/enroll`: action google/invite; `/api/auth/password/invite`: recent-owner issuance; `/api/auth/password/reset`: action issue/consume.
- POST `/api/auth/logout`: same-origin server logout.
- GET `/api/agents`: identity + Sheets only. GET `/api/inbox?email=...`: identity + unique Sheets alias + Cloudflare Worker.
- POST `/api/status`: same-origin JSON email/status BERHASIL or GAGAL, identity + Sheets only.

## Verification and release gates

Install worker test dependency first with `npm ci --prefix worker`. Gates: `npm test`; `cd worker && npm test`; `npm run build`; `node scripts/smoke.mjs`; `node scripts/smoke.mjs --configured`. Native tests use synthetic fetch/Redis/cookie fixtures, retain security regressions, not live integration proof. No lint/typecheck script exists. Run build/smoke only in filesystem-isolated source copy without live .env files/secrets; child env allowlist and explicit empty/test-only provider/Redis/KV/password values prevent inheritance. Next auto-loads env files: environment filtering alone is insufficient. Ports 3108/3109 checked free; stop only own verified child PID/cwd, never broad node/next kills or port 20128.

Browser gate: local production at 1440px and 390px, setup, Google/password disabled/errors, member/owner connection errors, keyboard forms/logout/focus, mobile overflow, synthetic rich-message fixture disconnected from production. Assert zero external preview image/font/activation requests, inert sandbox links. No shipped mock auth bypass and no real activation clicks. Missing browser tooling means BLOCKED, not passed.

Other release blockers: production project/SHA/env/rollback snapshot unknown; Google disabled_client repair and all four real logins/old-member denial unverified; owner Sheets permission/read unverified; Cloudflare Worker deploy, live KV and Email Routing catch-all unverified; local real postal-mime fixture is covered by worker tests. Status-write integration requires separately approved dedicated test workbook/cell and restoration, never live agent/demo rows. Real Redis capacity/availability/atomic behavior unverified. Demo remains received, NOT ACTIVATED. Historical workbook counts are not current counts.

J5 offline migration tool is not implemented by J4. No migration at app startup/build/deploy. Later alias-only migration requires separate full private backup, current manifest/checksum, exclusive edit freeze, explicit plan/apply approval and drift-aware journal rollback. No live workbook access or writes in coding acceptance. DEV owns commit/push/deploy/env/consent/delivery decisions; no false-green release with blocked gates.
