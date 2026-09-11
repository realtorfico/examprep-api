# examprep-api

Shared backend for examprep.softician.com (public) + examprep-admin.softician.com (admin).
Cloudflare Worker + D1, no framework, no build step.

## Setup (one-time, via Cloudflare dashboard — no local Wrangler on this machine)
1. Workers & Pages > D1 > Create database `examprep`, run `schema.sql` in its Console tab.
2. Paste the resulting `database_id` into `wrangler.jsonc`.
3. Workers & Pages > Create > Workers > Import a repository (this repo) for git-connected deploy.
4. Worker Settings > Variables & Secrets: `TURNSTILE_SECRET`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`.
5. In each of the `examprep` / `examprep-admin` Pages projects: Settings > Bindings > add a
   Service Binding to this Worker (`examprep-api`), so their `worker.js` can call it same-origin
   without any public hostname on this Worker.

## Tests
`node --test test/progress-consistency.test.js test/resource-ownership.test.js test/public-stats-caching.test.js test/difficulty-index-caching.test.js`
— runs against an in-memory DB via Node's built-in `node:sqlite` (no wrangler/workerd needed,
which matters since this repo can't run those locally on this machine). Node's `--test` flag
doesn't glob a bare directory on this machine's Node version (v22.17.1) -- pass files explicitly.
`progress-consistency` covers the 2026-08-05 admin-vs-site counter bug, `resource-ownership`
covers per-track resource access, `public-stats-caching` covers the 2026-09-11 uncached-full-scan
5xx-spike regression, `difficulty-index-caching` covers the same day's rewrite of the difficulty-
filtered next-question query (see each file's own header comment). Add more test files under `test/` as
needed, and add them to this command.

## Routes
Public (bearer token, minted by `/redeem`): `/questions/next`, `/answer`, `/progress`, `/prefs`.
Admin (Cloudflare Access-gated): `/console/codes`, `/console/codes/generate`, `/console/codes/revoke`,
`/console/questions` (+ `create`/`update`/`delete`/`import`), `/console/stats`.

See the architecture plan for the full design.
