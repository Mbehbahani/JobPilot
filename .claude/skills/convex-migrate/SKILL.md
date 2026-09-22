---
name: convex-migrate
description: Migrate this app's Convex backend between Convex Cloud, Railway (self-hosted), and AWS (self-hosted on EC2) in any direction. Use whenever the user asks to move/migrate Convex hosting, change where the backend runs, or set up a new self-hosted Convex environment.
---

# Convex hosting migration runbook

This skill encodes a real migration (Railway → AWS, later resized after a
production incident) end to end, including the mistakes made and how they
were caught. Follow it as a checklist, not a suggestion — every gotcha here
cost real debugging time or caused a real outage the first time around.

**Before touching anything**, identify:

1. **Source**: Convex Cloud (managed) / Railway (self-hosted) / AWS (self-hosted) / other self-hosted.
2. **Destination**: same three options.
3. Whether the destination is **fresh** or **reusing the same Postgres** as the source.

That last point is the single biggest fork in the road — read the next section
before planning anything else.

## Core concept: Convex splits state across two places

Self-hosted Convex (the `ghcr.io/get-convex/convex-backend` image, used by
both Railway's template and any DIY Docker setup) stores:

1. **Structured data** (tables, indexes, metadata) → **Postgres**.
2. **File/module blobs** (deployed function code, exports, search index
   files, user file uploads) → **local disk**, mounted at `/convex/data`.

Postgres migrating cleanly does **not** mean the migration is done. The
symptom of forgetting the disk half only shows up _after_ cutover, when a
deployed function throws `Local dir storage couldn't open
/convex/data/storage/modules/....blob: No such file or directory`. Confirmed
the hard way — caught in a pre-cutover test, not in production, only because
a test was actually run first. Always inspect
`/convex/data/storage/{modules,exports,search,snapshot_imports,files}` on the
source before declaring "just point at the same Postgres" sufficient.

**Convex Cloud (managed) does not expose its Postgres at all.** There is no
"point the new backend at the same database" option when Cloud is the
source or destination. Cloud migrations always go through
`convex export` / `convex import` (see below). Only self-hosted↔self-hosted
migrations can take the "reuse the same Postgres" shortcut.

## Decision tree

```
Source = Convex Cloud?
  → MUST use convex export/import (Cloud DB is not directly reachable).
    Also copy any file storage the export includes; verify large files
    (module blobs) came through, not just table rows.

Source and destination are both self-hosted (Railway/AWS/other),
and destination will reuse the SAME Postgres instance?
  → Fastest, safest path. No data export/import needed.
  → Copy the /convex/data volume separately (see below) — Postgres
    reconnection alone is NOT a full migration.
  → Reuse INSTANCE_NAME, INSTANCE_SECRET, CONVEX_SELF_HOSTED_ADMIN_KEY
    verbatim from the source. The admin key is derived from these; keeping
    them identical means zero re-auth needed anywhere in the app.
  → Only one backend can hold that Postgres connection at a time — plan
    a stop-old/start-new handoff, not a live A/B.

Source and destination are both self-hosted, but destination gets a
NEW/different Postgres (e.g. moving off Railway's Postgres too)?
  → Use convex export (from source) / convex import (to destination).
  → New INSTANCE_SECRET/admin key is fine and expected in this case.
```

## Step 1 — Reusing the same Postgres (self-hosted → self-hosted, fastest path)

This was the actual path used for Railway → AWS. Steps, in order:

### 1a. Expose the source Postgres publicly (if moving to a different network)

Railway example — Postgres is private-network-only by default:

```bash
railway tcp-proxy create --port 5432 --service Postgres
# -> public_host:port, e.g. some-name.proxy.rlwy.net:21648
```

Take the _existing_ backend's `POSTGRES_URL` and swap only the host:port —
keep user/password/path exactly as they were. Sanity-check reachability
before anything else:

```bash
node -e "require('net').createConnection({host:'HOST',port:PORT},()=>console.log('ok'))"
```

**Security note**: this connection now crosses the public internet. Check
whether the source enforces TLS on that path before treating it as
production-grade.

### 1b. Copy the `/convex/data` volume

Railway CLI, from the _running_ source service (no downtime needed — this is
a live filesystem read):

```bash
railway ssh keys add                       # once, registers a local SSH key
railway service files download /convex/data ./convex-data-export \
  --service "<Backend service name>" --overwrite
```

Gotchas:

- **On Windows, run this from PowerShell, not Git Bash.** Git Bash's MSYS
  layer rewrites leading-slash paths (`/convex/data` →
  `C:/Program Files/Git/convex/data`) before the CLI sees them — this either
  errors outright or silently downloads zero bytes. `MSYS_NO_PATHCONV=1
<command>` works around it in Bash if you must stay there.
- Compare downloaded size against what the platform reports for the volume;
  don't panic over a mismatch (filesystem overhead/reserved blocks are
  normal) but do spot-check `storage/modules` specifically — that's the
  deployed function code, and its absence is what breaks things post-cutover.
- An empty `storage/files` directory is not necessarily a bug — check whether
  the app actually uses Convex's local file storage feature before assuming
  data is missing.

Load it into the destination. If the destination runs Docker Compose with a
named volume:

```bash
scp -r ./convex-data-export/data user@dest-host:/tmp/convex-data-import
ssh user@dest-host '
  docker volume create <compose-project>_convex-data
  docker run --rm \
    -v <compose-project>_convex-data:/target \
    -v /tmp/convex-data-import:/source:ro \
    alpine sh -c "cp -a /source/. /target/"
'
```

### 1c. Build the destination's env file

Copy verbatim from the source backend's own env vars:
`INSTANCE_NAME`, `INSTANCE_SECRET`, `CONVEX_SELF_HOSTED_ADMIN_KEY`.
Set fresh: `POSTGRES_URL` (host:port swapped per 1a), `CONVEX_CLOUD_ORIGIN`,
`CONVEX_SITE_ORIGIN` (new hostnames), `DISABLE_BEACON=true`,
`DO_NOT_REQUIRE_SSL=true` if a reverse proxy in front terminates TLS.

### 1d. Test the connection _before_ the real cutover

Do a quick, reversible round-trip first:

1. Stop the source backend (releases the Postgres connection —
   Railway: `railway down --service "<name>" --yes`).
2. Start the destination backend pointed at the same Postgres.
3. Check logs for confirmation it recognized existing data (migrations
   running against real tablet/document IDs, not a fresh empty DB).
4. Stop the destination, restart the source
   (Railway: plain `redeploy` fails with "No deployment found" once `down`
   removed the deployment record — use `redeploy --service "<name>"
--from-source --yes` to redeploy fresh from the configured image).
5. Confirm the source is fully serving again before doing anything else.

Only after this succeeds, move to the real cutover (below).

## Step 2 — Export/import path (Convex Cloud involved, or moving to a fresh Postgres)

```bash
npx convex export --admin-key <source-admin-key> --url <source-url> snapshot.zip
npx convex import --admin-key <dest-admin-key> --url <dest-url> snapshot.zip
```

- This is the _only_ supported path when Convex Cloud is source or
  destination.
- The export is a zip of `<table>/documents.jsonl` files plus
  `_storage/documents.jsonl` and the actual blob files — inspect it directly
  if something needs verifying; it's just a zip, no special tooling required.
- **Save every export you generate.** They're disaster recovery gold — see
  the recovery section below, which used a 6-day-old incidental export to
  recover data that had been overwritten in production.
- A full import overwrites the _entire_ destination table(s) it touches. If
  the destination has since had independent legitimate writes (e.g. multiple
  users, ongoing traffic), a blanket import will stomp on those. For a
  surgical restore of specific records instead of a whole-table replace, see
  the recovery procedure below.

## Provisioning the destination (self-hosted)

### If destination = Railway

Use Railway's own Convex template (Postgres + Backend + Dashboard services).
This is the reference implementation — the images/env-var conventions used
everywhere else in this skill were reverse-engineered from it, so when
migrating _to_ Railway there's little custom setup needed; let the platform
do it.

### If destination = AWS (or any bare Docker host)

No managed Kubernetes needed for typical hobby/small-team budgets — price out
EKS before considering it: **the control plane alone is a fixed ~$73/month**,
before any node, load balancer, or storage. There is no cheaper EKS tier.
Unless the workload genuinely needs orchestration across multiple nodes, a
single Docker Compose host is functionally equivalent for far less.

Minimal architecture that's actually been run in production:

- One EC2 instance (or equivalent VM), **sized for real traffic, not idle
  cost-floor** — see the sizing section, this is the mistake that caused an
  actual outage.
- Docker Compose: `backend` (convex-backend image), optionally `dashboard`
  (convex-dashboard image — see sizing note on whether to run it 24/7),
  `caddy` (reverse proxy, free automatic Let's Encrypt TLS per hostname —
  no ALB/ACM needed).
- One Elastic IP, security group open on 80/443 + SSH restricted to one
  operator IP. No load balancer, no NAT gateway, no managed database unless
  actually moving Postgres too.
- Terraform gotchas hit in practice:
  - AL2023 arm64 AMI's root snapshot requires **≥30GB**; a smaller root
    volume fails at `apply` time with `InvalidBlockDeviceMapping`.
  - `aws login` (browser-based root session) writes a `login_session` key
    that Terraform's AWS provider does not understand — use a real IAM user
    profile (`aws configure` with an access key, or `profile = "..."` in the
    provider block).

## Sizing — the mistake that caused a real outage, don't repeat it

The first pass sized purely for the cost floor (`t4g.micro`, 1GB RAM) and it
was not enough for the Convex backend under real traffic:

- The backend process itself uses ~300MB RSS — fine in isolation.
- But on a single-host Docker Compose setup, that RAM is shared with the
  _entire_ OS/Docker stack that a platform like Railway or Convex Cloud
  abstracts away for you: `dockerd`, `containerd`, `systemd`, `journald`,
  `sshd`, plus Caddy and (if running) the Dashboard. That overhead alone
  can be 100-150MB+.
- With no swap configured, once combined usage approached the physical
  ceiling, the box didn't just get slow — it locked up completely
  (SSH and HTTPS both stopped responding, requiring a hard reboot via the
  cloud provider's API, not SSH).
- After reboot, `free -h` showed **~500MB actively swapped to disk during
  normal operation** — meaning every query was paying real, disk-backed
  latency, which is what "the app feels slow" actually was.

**Do this from the start, not after an incident:**

1. Add swap immediately on any single-host self-hosted deployment, even a
   "big enough" one — it's free insurance against a total lockup:
   ```bash
   sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile swap swap defaults 0 0' | sudo tee -a /etc/fstab
   ```
2. Don't run the Dashboard 24/7 on a memory-constrained box — it's low
   traffic by nature (matches how it behaved on Railway too, mostly idle).
   Gate it behind a Compose profile so `docker compose up -d` skips it by
   default:
   ```yaml
   dashboard:
     profiles: ['dashboard'] # start on demand: docker compose --profile dashboard up -d dashboard
   ```
   If `caddy`'s `depends_on` lists `dashboard`, remove that reference —
   Compose refuses to run at all ("undefined service") if a `depends_on`
   target is excluded by profile.
3. **Provision for real production load, not idle behavior.** If in doubt,
   size up one tier from the theoretical minimum. The cost delta between
   `t4g.micro` and `t4g.small` was ~$6/month — trivially cheap compared to
   the cost of a production incident.
4. Resizing later is non-destructive but requires a stop/start (EBS
   persists, Elastic IP re-attaches automatically, Docker's
   `restart: unless-stopped` brings containers back up on their own) —
   budget a few minutes of downtime, not zero.

## Cutover procedure (once source→destination connection is verified)

1. **DNS for brand-new hostnames first** (anything not currently in use) —
   safe to add anytime.
2. **Stop the source backend** for good.
3. **Repoint DNS for the hostname that's actually live today** at the
   destination. If using Cloudflare, use **DNS-only (grey cloud), not
   proxied** — a reverse-proxy-terminated TLS setup (e.g. Caddy) needs to
   directly receive the HTTP-01 ACME challenge, which Cloudflare's proxy
   would intercept.
4. **Start the full stack** at the destination. Caddy (or equivalent)
   requests certs per-hostname on first request; this needs DNS already
   resolving to the new IP.
5. **Update the app's env vars.** A platform-assigned domain (e.g.
   `*.up.railway.app`) can't be kept when leaving that platform — that var
   _must_ change. A custom domain whose DNS just moved can often keep its
   existing env var value unchanged. Redeploy the frontend after any change.
6. **Verify end-to-end against the new backend** before treating the old
   deployment as disposable. Don't just check HTTP status codes — actually
   query real data (see verification section).

Expect a genuine downtime window — DNS propagation, ACME issuance, and a
frontend redeploy are not instant. Budget several minutes.

**A forced re-login is a likely side effect of any domain change** (session
cookies/JWT validation tied to trusted origins). Treat that specifically as a
risk window: if the backend is at all degraded during that moment, a client
re-establishing its session is exactly the kind of edge case that can trigger
a save-with-empty/stale-local-state bug in poorly-guarded client code. This
is suspected (strong circumstantial evidence, not proven) to be what caused
a real data-loss incident during this migration — see recovery section.
**Mitigation:** make sure the destination is verified stable under load
_before_ cutover, specifically so nobody hits a slow/degraded backend at the
exact moment they're forced to re-authenticate.

## Verification — don't trust HTTP 200s alone

`curl` returning 200 only proves the process is up, not that data survived
intact. Use the Convex CLI directly against the deployment:

```bash
# List all top-level tables
CONVEX_SELF_HOSTED_URL=<url> CONVEX_SELF_HOSTED_ADMIN_KEY=<key> npx convex data

# List tables inside a component (e.g. an auth library implemented as a
# Convex component — check convex.config.ts for registered component names)
CONVEX_SELF_HOSTED_URL=<url> CONVEX_SELF_HOSTED_ADMIN_KEY=<key> npx convex data --component <name>

# Inspect a specific table's rows
CONVEX_SELF_HOSTED_URL=<url> CONVEX_SELF_HOSTED_ADMIN_KEY=<key> npx convex data <table> --format jsonl --limit 100
```

To check a _specific user's_ data specifically (not just "the table has
rows"): find their internal user id via the auth component's `user` table
(match on email), then cross-reference that id against whatever table holds
their actual content (e.g. `userId` field). Don't assume row count alone
means the right data survived — check ownership and `updatedAt` timestamps
too. An unexpectedly recent `updatedAt` on a record you didn't touch is a
signal something else wrote to it — investigate before assuming migration
success.

## Emergency recovery — if something got overwritten/lost

Self-hosted Convex doesn't expose point-in-time document history through
the standard CLI. But **any `convex export` ever taken — including
incidental ones sitting in `/convex/data/storage/exports` on a self-hosted
instance — is a full point-in-time snapshot**, inspectable without a live
backend:

```bash
unzip snapshot.zip -d extracted/
# extracted/<table>/documents.jsonl — one JSON object per line
# extracted/_components/<name>/<table>/documents.jsonl — component tables
```

If a specific record needs restoring **without** clobbering other
records/users that have had legitimate changes since the snapshot was taken
(a blanket `convex import` would overwrite the whole table):

1. Extract the exact field value(s) needed from the snapshot's
   `documents.jsonl` for that specific `_id`/owner.
2. Write a narrowly-scoped, one-off `internalMutation` that looks up the
   specific record (e.g. by an owner/user id via an existing index) and
   patches _only_ the affected field(s) — not a general-purpose restore
   endpoint, not wired into any client-facing API.
3. If the payload is large, don't pass it as a CLI argument (Windows/Bash
   argument-length limits bite well under 1MB) — save it as a co-located
   `.json` file and `import` it directly in the mutation's source instead.
4. Deploy, run once (`npx convex run <file>:<function> "{}"`), verify via
   `convex data` that the specific record now matches, then **delete the
   mutation and its embedded data file and redeploy** so no trace of the
   one-off script or the payload lingers in the codebase.
5. Be explicit with whoever's data this is about the snapshot's age — recent
   changes made after that snapshot was taken are not recoverable this way.

## Command reference

```bash
# Railway
railway link -p <project>                          # link CLI to a project
railway status --json                               # full project/service state incl. region
railway variables --service "<name>" --kv            # env vars for a service
railway tcp-proxy create --port 5432 --service "<name>"   # expose a private service publicly
railway ssh keys add                                  # register local SSH key (needed for `service files`)
railway service files download <remote> <local> --service "<name>" --overwrite
railway service files list <remote> --service "<name>" --json
railway down --service "<name>" --yes                 # stop (removes deployment record)
railway redeploy --service "<name>" --from-source --yes   # bring back after `down`

# Convex CLI (self-hosted, against any deployment)
npx convex data                                        # list tables
npx convex data --component <name>                     # list a component's tables
npx convex data <table> --format jsonl --limit N        # inspect rows
npx convex deploy                                        # push current codebase's functions
npx convex run <file>:<export> '<json-args>'             # invoke a function once
npx convex export --admin-key <key> --url <url> out.zip
npx convex import --admin-key <key> --url <url> in.zip

# AWS
aws sts get-caller-identity                             # confirm which identity/profile is active
aws ec2 reboot-instances --instance-ids <id>              # non-destructive recovery lever, no SSH needed
aws ec2 describe-instance-status --instance-ids <id>       # check health without SSH
```

## Windows-specific gotchas (applies throughout)

- Git Bash (MSYS) rewrites leading-slash paths before native Windows CLIs see
  them. Prefix with `MSYS_NO_PATHCONV=1`, or just run the command from
  PowerShell instead — safer default for anything doing remote-path
  arguments (Railway's `service files`, in particular).
- Node.js on Windows does not understand Git-Bash-style `/c/Users/...`
  paths — use `C:/Users/...` (forward slashes are fine) when a Node one-liner
  needs to read/write a file from within a Bash session.
