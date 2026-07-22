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

## Routes
Public (bearer token, minted by `/redeem`): `/questions/next`, `/answer`, `/progress`, `/prefs`.
Admin (Cloudflare Access-gated): `/console/codes`, `/console/codes/generate`, `/console/codes/revoke`,
`/console/questions` (+ `create`/`update`/`delete`/`import`), `/console/stats`.

See the architecture plan for the full design.
