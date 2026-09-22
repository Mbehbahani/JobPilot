# Decisions

Run `20260910T153436Z-convex-huawei` · 2026-09-10

Each decision records what was chosen, what it was chosen over, and why. Where a decision was
forced by evidence rather than preference, the evidence is named.

---

## D-01 — Trust the probe, not the registry

**Decision.** Treat `infra/aws-convex/MIGRATION.md` as describing the live topology and
`D:\Account Center\Convex\README.md` as stale.

**Alternative.** Follow the Account Center registry, which is the designated source of truth for
"where things run" and was stamped only three days earlier (2026-09-07).

**Why.** Neither document was believed. `convex-backend-production-f015.up.railway.app/version`
returns Railway's edge `404 Application not found` — the service has no deployment — while
`convex-cloud.oploy.eu` and `convex-site.oploy.eu` both return `200` from `3.120.122.232`, the
Elastic IP in `terraform.tfstate`. The deployed frontend's HTML references
`https://convex-cloud.oploy.eu`. The registry's own rule applies here: _"A stamp older than ~2
weeks means unknown, not still true"_ — this one was newer than that and still wrong, which is the
stronger lesson.

**Consequence.** `D:\Account Center\Convex\README.md` is materially wrong and should be corrected.
It is on the follow-up list; the Vault and Account Center were not edited during this run.

---

## D-02 — Logical export/import, never a volume or PGDATA copy

**Decision.** Migrate with `convex export` → `convex import --replace-all` → `convex deploy`.

**Alternative.** Copy the `/convex/data` Docker volume and the Postgres data directory, as the AWS
runbook did for the volume.

**Why — corrected after independent evaluation.** The decisive reason is **access, not
architecture**:

1. Neither source data location was ever reachable. The source `PGDATA` lives inside Railway's
   managed Postgres, so there is no filesystem access to it at all; `/convex/data` sits on the EC2
   host, which became unreachable when the SSH ingress change was denied (D-12). A physical copy
   was impossible before architecture entered the picture.
2. The architecture does change — arm64 → x86_64 (verified `uname -m`) — so a physical `PGDATA`
   copy would additionally be _unsupported_. Worth being precise: unsupported, not impossible.
   Both platforms are little-endian LP64 and such copies frequently work. It is simply not
   something to stake production data on, and the instruction was explicit: _"Do not blindly copy
   database directories between platforms."_
3. `/convex/data` holds modules and search indexes tied to a specific backend build.
4. The logical path is what Convex documents for moving a self-hosted deployment.

**Alternative the original draft failed to consider:** `pg_dump` / `pg_restore` against Railway's
public TCP proxy. It was reachable and architecture-safe. `convex export` is still better —
component-aware, carries file storage, rebuilds search and vector indexes, needs no Postgres
client — but the alternatives analysis was incomplete, and the original entry read as more forced
than the situation actually was.

---

## D-03 — Keep `INSTANCE_NAME=railway` and reuse `INSTANCE_SECRET`

**Decision.** Copy `INSTANCE_NAME` and `INSTANCE_SECRET` verbatim; do not "fix" the misleading name.

**Alternative.** Rename the instance to something honest like `huawei` or `jobpilot`.

**Why.** The backend derives its identity from `INSTANCE_SECRET`, and the existing
`CONVEX_SELF_HOSTED_ADMIN_KEY` stays valid only if both are preserved. Renaming would invalidate
the admin key and every deploy key derived from it, turning a data migration into a credential
rotation. Verified empirically: the unchanged admin key authenticates against Huawei.

**Consequence.** The Postgres database on Huawei is also named `railway`, because the backend
derives the database name from `INSTANCE_NAME` (hyphens → underscores). Confusing, and recorded as
finding F-03 so nobody "corrects" it later without understanding the cost.

---

## D-04 — Pin images by digest, not by tag

**Decision.** Pin `convex-backend`, `convex-dashboard` and `postgres` by SHA-256 digest.

**Alternative.** Use `:latest`, as the AWS deployment does.

**Why.** The upstream project publishes 569 tags, all commit SHAs, plus `latest` — there is no
semver to pin to. `:latest` means the running version is not reproducible, which is finding F-05
against the current AWS deployment, where `/version` reports literally `unknown`. Digest pinning
is the only reproducible option and makes a rebuild deterministic.

---

## D-05 — Do not publish Postgres to the host

**Decision.** The destination Postgres has no host port mapping; it is reachable only from the
backend container over the `convex-huawei-net` bridge.

**Alternative.** Publish `5432` for convenience, as `oploy-test-db` effectively does internally.

**Why.** The box sits on shared building WiFi where any other resident's device can reach an open
port. This is strictly better than the source, where production database traffic crosses the
public internet to `kodama.proxy.rlwy.net:21648` with no `sslmode` and `DO_NOT_REQUIRE_SSL=true`
(finding F-02). Not publishing it also makes `DO_NOT_REQUIRE_SSL=true` genuinely harmless on the
destination, where it covers a private bridge rather than the open internet.

---

## D-06 — Import first, deploy functions second

**Decision.** Restore data into a backend with **no functions deployed**, set environment
variables, and only then deploy functions.

**Alternative.** Deploy functions first, then import.

**Why.** A backend with no functions has no crons, no actions and no HTTP routes — it is inert. So
no copied schedule, queue entry or webhook handler could fire while the destination was still
half-configured. By the time functions existed, email, billing and webhook secrets were already
inert. This is what "prevent copied schedules, queues, email, billing, Nova actions, and webhooks
from producing real side effects" required in practice.

---

## D-07 — Neutralise side effects with invalid credentials, not by deleting them

**Decision.** Set `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` and `AUTUMN_SECRET_KEY` to inert
placeholder strings on the destination.

**Alternative A.** Leave the real values — risks real emails to real users and real billing calls
against real customers restored from the snapshot.
**Alternative B.** Unset them — `src/lib/convex/env.ts` throws on missing required vars, so
functions would crash rather than degrade.

**Why.** A syntactically valid but unauthorised credential makes the outbound call fail at the
provider, which is exactly the desired behaviour: the code path runs, nothing real happens. The
cost is that these integrations cannot be tested, so they are reported **pending**, never passed.

---

## D-08 — A separate Vite build mode instead of editing the project's env files

**Decision.** Create `.env.huawei.local` and build with `vite build --mode huawei`.

**Alternative.** Edit `.env.local` to point at Huawei.

**Why.** `PUBLIC_CONVEX_URL` is read through `$env/static/public`, so it is baked in at build
time — a runtime override would not work. Editing `.env.local` would have destroyed the developer's
existing configuration and left the repo in a state that silently targets a test backend. A custom
mode takes precedence over `.env.local` in Vite, is gitignored by the existing `*.local*` rule, and
is deletable in one step.

---

## D-09 — A separate Playwright config instead of changing the project's

**Decision.** Add `playwright.migration.config.ts` and run the existing suite with `CI=1`.

**Alternative.** Edit `playwright.config.ts` to change `baseURL` and drop the `webServer` block.

**Why.** `playwright.config.ts` starts `bun run dev:frontend` on port 5173 unless `CI` is set, and
`AGENTS.md` line 36 says the dev server is already running in its own terminal and must never be
started a second time. `CI=1` disables that block without touching the file. The separate config
also keeps the migration-specific tests out of the project's normal suite.

---

## D-10 — Restore `SITE_URL` to its production value during testing

**Decision.** Set `SITE_URL=https://jobpilot.oploy.eu` on the isolated destination and add
`http://localhost:4173` to `BETTER_AUTH_TRUSTED_ORIGINS`.

**Alternative.** Keep `SITE_URL=http://localhost:4173`, which seemed like the obvious "isolated"
value and was the first thing tried.

**Why.** It broke sign-in, and the reason is worth recording. `src/routes/api/auth/[...all]/+server.ts`
carries a deliberate localhost shim that assumes the upstream `SITE_URL` is HTTPS, so Better Auth
issues `__Secure-`-prefixed cookies; the shim renames them for a plain-HTTP localhost frontend and
renames them back on requests. With an HTTP `SITE_URL`, Better Auth issued unprefixed cookies, and
the shim then rewrote the browser's `better-auth.session_token` into
`__Secure-better-auth.session_token` on the way upstream — where nothing was looking for it.
Production already trusts `http://localhost:5173` for exactly this workflow, which confirms the
HTTPS-upstream/HTTP-localhost pattern is intended.

**Consequence.** This was a defect in my test configuration, not in the migration or the app. Fixed
and recorded rather than quietly corrected.

---

## D-11 — Propose Cloudflare Tunnel; build nothing until approved

**Decision.** Design the public ingress, document it, and stop.

**Alternative.** Set up a tunnel now so the migration could be "finished".

**Why.** This creates a new public exposure of Mohammad's home server, and the instruction requires
approval for that. It also needs Cloudflare credentials that are not currently available (both
Cloudflare MCP servers read "Needs authentication"; neither `wrangler` nor `cloudflared` is
installed). Building it silently would be both unauthorised and impossible.

---

## D-12 — Add an SSH ingress rule to the AWS security group (attempted, denied)

**Decision as taken.** Attempt to add the current operator IP `80.113.2.188/32` to
`sg-07789c8d3a90f8788` for port 22, because the group still only allows a stale IP
(`80.113.56.156/32`) and the EC2 host was otherwise uninspectable.

**Outcome.** Denied by the host permission classifier. Not retried, not worked around.

**Why it did not matter much.** The blocked access would have given the exact running image digest
and a directory listing of `/convex/data`. Neither is required, because D-02 rules out copying that
volume anyway. Recorded as a known inventory gap rather than papered over.

---

## D-13 — Run the dashboard by default, and accept that it is broken

**Decision.** Define the dashboard as a normal service rather than behind a compose profile, and
report its failure rather than hiding it.

**Why.** The AWS stack puts the dashboard behind `profiles: [dashboard]`, so `docker compose up -d`
never starts it while Caddy still advertises `convex-dashboard.oploy.eu` — which is why that
hostname has been returning 502 (finding F-01). Not reproducing that trap was deliberate. The
destination dashboard then failed anyway, for an unrelated upstream reason: the published image
cannot resolve one of its own bundled modules. Three further published builds were pulled and
probed; all three returned HTTP 500. It is an upstream packaging defect, not a configuration error,
and it is not a regression — the source dashboard is unavailable today too.

**Consequence.** Administration is via the Convex CLI, which works completely against the
destination. Recorded as a follow-up item.

---

## D-14 — Set `AUTH_E2E_TEST_SECRET` on the destination only

**Decision.** Generate a fresh e2e test secret and set it on the isolated Huawei deployment.

**Why.** It is empty on production, so the project's e2e suite has never been runnable there. A
test secret that enables `tests:verifyTestUserEmail` and `tests:createTestAdminUser` is exactly the
kind of thing that belongs on an isolated deployment and not on production. It was not set on
production and must not be.

---

## D-15 — Merge, never overwrite, JobPilot's MCP configuration

**Decision.** Add `personal_harness` to `.mcp.json` alongside the existing `svelte`, `convex`,
`unipile` and `playwright` entries, keeping a `.mcp.json.bak-premigration` copy.

**Why.** The instruction was explicit about not overwriting existing entries. The resulting `git
diff` is purely additive — six added lines, nothing removed or reformatted. A first attempt
reformatted the pre-existing arrays as a side effect of JSON round-tripping; that was reverted so
the diff stays additive only.
