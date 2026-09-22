# MIG-001 — Inventory and baseline

Status: **PASS (generator)** · awaiting independent evaluator
Recorded: 2026-09-10 (UTC timestamps inline)

## 1. The records conflicted. Here is what is actually true.

Two documents disagreed about where JobPilot's Convex backend runs:

| Source                                                    | Claim                                                                                                           | Verdict                                                   |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `D:\Account Center\Convex\README.md` (stamped 2026-09-07) | Backend is self-hosted **on Railway** at `convex-backend-production-f015.up.railway.app`; JobPilot points there | **STALE / WRONG**                                         |
| `infra/aws-convex/MIGRATION.md` (untracked, undated)      | Backend moved to **AWS EC2**, database left on Railway Postgres                                                 | **CORRECT, and the migration it describes was completed** |

Neither was accepted on faith. The topology below was established by probe.

### Evidence that decided it

```
2026-09-10T15:38Z
curl https://convex-cloud.oploy.eu/version                    -> http=200 ip=3.120.122.232  body: "unknown"
curl https://convex-site.oploy.eu/version                     -> http=200 ip=3.120.122.232  body: "unknown"
curl https://convex-dashboard.oploy.eu/                       -> http=502 ip=3.120.122.232
curl https://convex-backend-production-f015.up.railway.app/version
     -> http=404 ip=69.46.46.53
        {"status":"error","code":404,"message":"Application not found"}
curl -L https://jobpilot.oploy.eu/  -> 200 (final https://jobpilot.oploy.eu/en) ip=188.114.97.0 (Cloudflare)
        served HTML references: https://convex-cloud.oploy.eu , https://convex-site.oploy.eu
```

`3.120.122.232` is the Elastic IP of the AWS EC2 instance in `terraform.tfstate`.
The Railway backend hostname returns Railway's edge "Application not found", i.e. the service
has no deployment. **The deployed frontend talks to AWS.** The Railway backend is dead.

## 2. Authoritative live topology (verified 2026-09-10)

| Layer                        | Where it actually runs                                                                       | Identifiers                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Convex backend (compute)** | **AWS EC2**, eu-central-1b                                                                   | `i-03a95de5085f45cd6`, `t4g.small`, **arm64**, AMI `ami-09a34060befa6c952`, launched 2026-08-02T10:30:51Z                                                                    |
| Public IP                    | Elastic IP                                                                                   | `3.120.122.232` (`eipalloc-08ad0bb1031a91ed8`)                                                                                                                               |
| Root volume                  | EBS gp3 30 GB                                                                                | `vol-032bdf0739a4902e1`                                                                                                                                                      |
| Security group               | `sg-07789c8d3a90f8788` (`convex-backend-sg`)                                                 | 80/tcp + 443/tcp from `0.0.0.0/0`; 22/tcp from `80.113.56.156/32` only                                                                                                       |
| Ingress / TLS                | Caddy 2 on the instance, Let's Encrypt per hostname                                          | `convex-cloud.oploy.eu` → backend:3210, `convex-site.oploy.eu` → backend:3211, `convex-dashboard.oploy.eu` → dashboard:6791                                                  |
| **Database**                 | **STILL ON RAILWAY** — project `convex`, service `Postgres`                                  | `postgres:17`, digest `sha256:7ad98329d513dd497293b951c195ca354274a77f12ddbbbbf85e68a811823d72`, deployment `053b2570-2e27-4c02-9665-78532a1d6b16`, RUNNING since 2026-04-21 |
| DB reachability              | Railway public TCP proxy                                                                     | `kodama.proxy.rlwy.net:21648`, user `postgres`, **no `sslmode` in the URL**                                                                                                  |
| Convex database name         | derived from `INSTANCE_NAME`                                                                 | `INSTANCE_NAME=railway` → Postgres database **`railway`**                                                                                                                    |
| **File / module storage**    | Docker named volume `convex-deploy_convex-data` on the EC2 EBS disk                          | `/convex/data` in the backend container                                                                                                                                      |
| Dashboard                    | **not running** — compose `profiles: [dashboard]`, so `docker compose up -d` never starts it | `convex-dashboard.oploy.eu` returns 502                                                                                                                                      |
| Frontend                     | `jobpilot.oploy.eu`, behind **Cloudflare** (`188.114.97.0`), `/` → `/en`                     | not on Huawei; not in scope to move                                                                                                                                          |
| DNS                          | Cloudflare zone `oploy.eu`                                                                   | `convex-*.oploy.eu` all resolve to the AWS EIP                                                                                                                               |

### Railway `convex` project — what remains (project `5882fd90-3843-4a0d-8293-47b25d360649`)

| Service                                                     | State                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Postgres` (`b16b2337-4181-4f93-a0c9-5fea416d8543`)         | **RUNNING — this is the live production database**                                                                                                            |
| `Convex Backend` (`e3018eb8-0707-494a-8cd5-e7a0c15b8023`)   | No deployment (torn down). **Still holds the custom-domain claim `convex-site.oploy.eu` → port 3211**, currently overridden by Cloudflare DNS pointing at AWS |
| `Convex Dashboard` (`dab48a38-428e-4ae3-b3a0-415a28bcddbf`) | `deploymentStopped: true`                                                                                                                                     |

## 3. Application surface (`src/lib/convex/`, Convex client **1.35.1**)

**15 application tables** (live, via `convex data`):
`adminAuditLogs, adminNotificationPreferences, adminSettings, emailEvents, fileMetadata,
gmailConnections, internalUserNotes, messages, openaiConnections, pendingAdminNotifications,
savedScripts, supportThreads, taskNotifications, todoBoards, userSettings`

**Components** declared in `convex.config.ts`: `betterAuth`, `resend`, `autumn`, `agent`,
`rateLimiter`, `convexFilesControl` (nests `actionRetrier`; `resend` nests `emailWorkpool`,
`callbackWorkpool`, `rateLimiter`).

**Scheduled work** (`crons.ts`) — 4 cron jobs, all with real side effects:

| Cron                  | Interval | Target                                        |
| --------------------- | -------- | --------------------------------------------- |
| `deleteUnusedFiles`   | 1 h      | `internal.files.vacuum.deleteUnusedFiles`     |
| `cleanupExpiredFiles` | 1 h      | `internal.files.cleanup.cleanupExpiredFiles`  |
| `deleteEmptyThreads`  | 6 h      | `internal.support.threads.deleteEmptyThreads` |
| `recoverStaleTasks`   | 5 min    | `internal.todo.cleanup.recoverStaleTasks`     |

**HTTP actions / webhooks** (`http.ts`, served on `convex-site.oploy.eu`):
Better Auth routes (`authComponent.registerRoutes`), `POST /resend-webhook`,
`POST /api/integration/add-job`, `POST /api/integration/check-duplicate` (+ CORS preflights).

**External integrations**: Resend (email), Autumn (billing), Google OAuth, Gmail OAuth,
GitHub OAuth (unconfigured), OpenAI/Codex OAuth, OpenRouter (support LLM), Unipile,
Supabase (personal search), AWS API Gateway `dctvnm5py6.execute-api.eu-central-1.amazonaws.com`,
PostHog, Google Analytics.

**Deployment environment variables**: 23 set on the deployment (names in
`evidence/convex-env-names.txt`; values never read into any report). 7 are empty strings.

## 4. Backup taken (source of truth for MIG-003)

Convex's own supported snapshot export, run read-only against the **live AWS backend**:

```
2026-09-10T15:40:43Z  convex export --include-file-storage --path <backup>/convex-snapshot.zip
2026-09-10T15:40:53Z  ok — snapshot timestamp 1789054845273441381
```

|          |                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------- |
| Location | `C:\Backups\jobpilot-convex\<run_id>\convex-snapshot.zip` — **outside Git, outside `reports/`** |
| Size     | 3,496,721 bytes                                                                                 |
| SHA-256  | `bf6755977d2145bfe31d78818f7978c1da83e62cbb6c567240c843ff6e575c16`                              |
| Entries  | 155                                                                                             |

### What the export provably contains — verified by reading the ZIP index, not from docs

The published documentation does not state whether component data is included; a direct
documentation fetch could not answer it. It was determined empirically. **It is** — recursively,
including nested components:

- All 15 application tables.
- `_components/betterAuth/` — `user`, `session`, `account`, `jwks`, `passkey`, `verification`.
  **User accounts and sessions survive the migration.**
- `_components/agent/` — `messages` (13.1 MB uncompressed, the bulk of the data), `threads`,
  `streamDeltas`, `streamingMessages`, `memories`, `files`, `apiKeys`, all 11 `embeddings_*` tables.
- `_components/resend/` — `emails`, `content`, `deliveryEvents`, `lastOptions`, plus nested
  `emailWorkpool`, `callbackWorkpool`, `rateLimiter`.
- `_components/autumn/`, `_components/rateLimiter/`, `_components/convexFilesControl/`
  (+ nested `actionRetrier`).

### What it provably does NOT contain — handled separately

| Excluded                                        | Consequence                                | Handling                                              |
| ----------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| Deployed function code (modules)                | Restored backend has data but no functions | `convex deploy` from repo source (the supported path) |
| Deployment environment variables                | Functions throw on missing vars            | Re-set all 23 on the destination                      |
| Pending `_scheduled_functions` / in-flight jobs | Queued work is lost                        | Accepted; crons are code-defined and return on deploy |
| Search / vector index files                     | —                                          | Rebuilt from schema on import                         |

### Finding: file storage is currently **empty**

Every `_storage/documents.jsonl` in the archive — root and every component — is **0 bytes**, and
`fileMetadata` is empty. There is **no stored file data to migrate today**. This removes a
migration risk but does not remove the obligation to test upload/download after the move, because
the code path is live.

## 5. Findings — pre-existing, NOT migration regressions

Recorded here so they are never later mistaken for damage caused by this migration.

| #    | Finding                                                                                                                                                                                                                                                                            | Severity   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| F-01 | **The Convex dashboard has been down since the AWS cutover.** `convex-dashboard.oploy.eu` → 502. `docker-compose.yml` puts the dashboard behind `profiles: [dashboard]`, so a plain `docker compose up -d` never starts it, while Caddy still advertises the hostname.             | Medium     |
| F-02 | **Production database traffic crosses the public internet without enforced TLS.** `POSTGRES_URL` targets `kodama.proxy.rlwy.net:21648` with no `sslmode` parameter, and the backend runs `DO_NOT_REQUIRE_SSL=true`. Flagged as an open question in `MIGRATION.md`; never resolved. | **High**   |
| F-03 | **`INSTANCE_NAME` is literally `railway`** on an AWS-hosted backend, so the Postgres database is also named `railway`. Cosmetically wrong, and it must NOT be "fixed" during migration — the admin key derives from `INSTANCE_NAME` + `INSTANCE_SECRET`.                           | Low (trap) |
| F-04 | **Deployed backend contains a `unipile` component that `convex.config.ts` does not declare.** The export shows `_components/unipile/` (empty). A `convex deploy` from current repo source would drop it.                                                                           | Medium     |
| F-05 | **Backend image is `:latest`, unpinned**, on both EC2 and in compose. The running version is not reproducible, and `/version` reports `unknown`.                                                                                                                                   | Medium     |
| F-06 | **Railway still holds a custom-domain claim on `convex-site.oploy.eu`** for a service with no deployment. Currently harmless (Cloudflare DNS wins) but a live split-routing hazard.                                                                                                | Medium     |
| F-07 | Local `.env.local` / `.env.convex.local` still set `PUBLIC_CONVEX_URL` to the **dead Railway URL**. Local dev against these files targets nothing.                                                                                                                                 | Medium     |
| F-08 | `SITE_URL` in `.env.convex.local` is `http://jobpilot.oploy.eu` while the deployment's real `SITE_URL` is the `https://` form. Local file is stale.                                                                                                                                | Low        |
| F-09 | `.env.convex.local` contains two admin-key strings pasted as free-text notes. The file is gitignored, but these are full-admin credentials sitting in a notes blob.                                                                                                                | Medium     |
| F-10 | Terraform drift: `MIGRATION.md` documents `t4g.micro`; the instance actually running is **`t4g.small`**.                                                                                                                                                                           | Low        |

## 6. Architecture and compatibility constraints for the destination

|                  | Source (AWS)                     | Destination (Huawei)                                   |
| ---------------- | -------------------------------- | ------------------------------------------------------ |
| CPU architecture | **arm64** (Graviton `t4g.small`) | **x86_64** (verified `uname -m`)                       |
| OS               | Amazon Linux 2023                | Ubuntu 24.04.4 LTS                                     |
| CPU / RAM        | 2 vCPU / 2 GB                    | 8 cores / 7.5 GiB                                      |
| Free disk        | 30 GB EBS                        | 130 GB free on `/` (148 G total)                       |
| Postgres         | Railway `postgres:17`            | to be provisioned, pinned `postgres:17`                |
| Docker           | Compose v2 on AL2023             | Docker 29.1.3, **compose plugin absent** — see MIG-002 |

**The architectures differ.** Therefore: no raw copy of `/convex/data`, and no raw copy of a
Postgres `PGDATA` directory. Migration uses the **logical, version-compatible** path only —
`convex export` → `convex import --replace-all` → `convex deploy` — which is also what Convex
documents for moving a self-hosted deployment between storage backends and hosts.

## 7. Acceptance criteria for the migration (fixed here, before implementation)

| ID    | Criterion                                                                                             | Check                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| AC-1  | Convex backend runs on Huawei, pinned image, restarts unless stopped                                  | `docker inspect` restart policy + container up after reboot                       |
| AC-2  | A dedicated Postgres runs on Huawei on an isolated network + named volume, holding database `railway` | `docker network inspect`, database list                                           |
| AC-3  | Restored table set equals source table set, component-for-component                                   | ZIP index vs destination enumeration                                              |
| AC-4  | Restored row counts match source for every non-empty table                                            | scripted comparison, aggregate only                                               |
| AC-5  | Better Auth users/sessions restored; known user ids present                                           | id existence check, no PII in report                                              |
| AC-6  | Functions deployed to Huawei from repo source; function list matches                                  | `convex function-spec` diff                                                       |
| AC-7  | All 23 deployment env vars set on Huawei                                                              | name-only comparison                                                              |
| AC-8  | Side effects neutralised before first start (email, billing, webhooks, crons, agent)                  | documented + verified inert                                                       |
| AC-9  | Browser: sign-in, sign-out, session persistence against Huawei                                        | Playwright + manual browser                                                       |
| AC-10 | Board/task CRUD persists; realtime propagates across two sessions                                     | Playwright two-context test                                                       |
| AC-11 | File upload + download round-trip works                                                               | Playwright                                                                        |
| AC-12 | Container restart recovery + restore into a fresh volume both proven                                  | recorded run                                                                      |
| AC-13 | No source write occurs from the destination during testing                                            | destination points only at Huawei Postgres; verified by config + connection check |
| AC-14 | Public reachability path for browsers / OAuth / webhooks exists and is approved                       | **blocked — see cutover prerequisites**                                           |

## 8. Cutover prerequisites (not yet met)

1. **Public ingress for Huawei.** The server is on shared building WiFi behind a NAT whose router
   Mohammad does not control. LAN success does not prove public reachability. Cloudflare DNS
   currently points `convex-*.oploy.eu` at the AWS EIP. A cutover requires an approved public
   exposure arrangement — proposed in MIG-002. **Requires Mohammad's approval.**
2. **Cloudflare credential access** to move DNS / create a tunnel. Both Cloudflare MCP servers read
   "Needs authentication"; `wrangler` and `cloudflared` are not installed locally.
3. **Explicit cutover approval** after the destination is verified.
4. **Railway's stale `convex-site.oploy.eu` domain claim** should be released to remove the
   split-routing hazard (F-06) — decommissioning item, needs approval.

## 9. Blocked during this slice

| Action                                                                                                                          | Why attempted                                                                                                                                                          | Outcome                                                    |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `aws ec2 authorize-security-group-ingress` to add the current operator IP (`80.113.2.188/32`) to `sg-07789c8d3a90f8788` for SSH | The SG still allows SSH only from a stale IP (`80.113.56.156/32`), so the EC2 host is unreachable for direct inspection of the running image digest and `/convex/data` | **Denied by the host permission classifier.** Not retried. |

**Impact assessment: low.** The blocked access would have supplied F-05's exact running image
digest and a direct listing of `/convex/data`. It is _not_ required for the migration itself,
because the chosen path is Convex's logical export/import rather than a volume copy — and a raw
volume copy was ruled out anyway by the arm64 → x86_64 architecture change. Recorded as a known
inventory gap rather than worked around.
