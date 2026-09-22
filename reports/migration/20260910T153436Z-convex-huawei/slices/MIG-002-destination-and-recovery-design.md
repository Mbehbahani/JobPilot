# MIG-002 — Destination and recovery design

Status: **PASS with one upstream defect (dashboard)** · awaiting independent evaluator

## 1. Destination host, verified rather than assumed

| Property         | Value                                                               | How established                     |
| ---------------- | ------------------------------------------------------------------- | ----------------------------------- |
| Host             | Huawei laptop, Ubuntu 24.04.4 LTS, hostname `sohamoha`              | `ssh … "uname -m; lsb_release -ds"` |
| Address          | `10.130.231.5` (DHCP, building WiFi `Glide_Resident`)               | SSH connect + registry              |
| **Architecture** | **x86_64**                                                          | `uname -m`                          |
| CPU / RAM        | 8 cores / 7.5 GiB (6.7 GiB available)                               | `nproc`, `free -h`                  |
| Disk             | 148 G total, 123 G free after deployment                            | `df -h /`                           |
| Docker           | **29.1.3**                                                          | `docker --version`                  |
| Docker Compose   | **absent at start** → installed `docker-compose-v2` 2.40.3          | see §2                              |
| SSH              | key `claude-code-to-ubuntu-server`, passwordless; passwordless sudo | registry, confirmed live            |

### Pre-existing workloads — all preserved

| Service          | Port     | State after this work |
| ---------------- | -------- | --------------------- |
| Cockpit          | 9090     | untouched, HTTP 200   |
| Portainer CE     | 9443     | untouched, HTTP 200   |
| `oploy-test-app` | 8090     | untouched, HTTP 200   |
| `oploy-test-db`  | internal | untouched, running    |
| SSH              | 22       | untouched             |

Ports `3210`, `3211`, `6791` were confirmed **free** before use. The `apt` install was
dry-run first (`apt-get install -s`) and reported `0 upgraded, 1 newly installed, 0 to remove` —
nothing else touched, and no container was restarted. This follows the discipline the Huawei
registry demands after the `cockpit` metapackage / NetworkManager incident.

## 2. Why the migration method is logical export/import

> **Correction (independent evaluator, 2026-09-10).** An earlier draft led with the architecture
> change as _the_ forcing constraint. That over-attributed it. The reasons are ordered correctly
> below: **access was decisive; architecture is a supporting constraint.**

1. **Neither source data location was reachable in the first place.** The source `PGDATA` lives
   inside Railway's managed Postgres — there is no filesystem access to it at all. The source
   `/convex/data` volume sits on the EC2 host, which was unreachable because the SSH ingress
   change was denied (MIG-001 §9). A physical copy was impossible for **access** reasons before
   architecture entered the picture.
2. **The architecture changes**, arm64 (EC2 Graviton `t4g.small`) → x86_64. A physical PostgreSQL
   data-directory copy across platforms is **unsupported** — note _unsupported_, not physically
   impossible: both are little-endian LP64 and such copies often do work. It is not something to
   stake production data on, and the instruction was explicit about not doing it.
3. `/convex/data` holds modules and search indexes tied to a specific backend build, so copying it
   is undesirable independently of both points above.

**Alternative not taken:** `pg_dump` / `pg_restore` against Railway's public TCP proxy was a real,
reachable, architecture-safe option, and the earlier draft failed to consider it. `convex export`
is still the better choice — it is component-aware, carries file storage, rebuilds search and
vector indexes, needs no Postgres client, and is what Convex documents for moving a self-hosted
deployment — but it was not the _only_ option available.

Convex publishes multi-arch images, so one digest-pinned image is valid on both architectures
(verified: the pins are OCI image indexes, see §3).

## 3. What was deployed

Configuration is written to `infra/huawei-convex/`, mirroring the existing `infra/aws-convex/`
layout.

> **Correction (independent evaluator, 2026-09-10).** An earlier draft of this section said the
> configuration "lives in the repo". It does not — `git ls-files infra/huawei-convex` returns
> **0 files**; the directory is untracked (`?? infra/`). That is exactly the defect MIG-001 §1
> criticised in `infra/aws-convex/MIGRATION.md`, repeated here. It has **not** been committed,
> because committing was not requested and is Mohammad's call. Until it is committed, "reproducible"
> is true of the file contents but not of the repository.

| File                              | Purpose                                                                     |
| --------------------------------- | --------------------------------------------------------------------------- |
| `docker-compose.yml`              | the destination stack, images pinned **by digest**                          |
| `docker-compose.restore-test.yml` | throwaway stack used to prove the backup restores from scratch              |
| `.env.example`                    | documented template — **no secrets**, with the Railway-host trap called out |
| `.gitignore`                      | keeps `.env`, keys, dumps and archives out of Git                           |

On the server, the live copy is `~/convex-huawei/` (mode 700) with `.env` at mode 600.

### Pinned images — finding F-05 is not reproduced

| Service            | Digest                                                                    | Resolved platform here | Image built          |
| ------------------ | ------------------------------------------------------------------------- | ---------------------- | -------------------- |
| `convex-backend`   | `sha256:71acf855388a71ad2fc597cd1dbea3fd262e179a07f93e754842a522024f1034` | amd64                  | 2026-09-08T18:02:05Z |
| `convex-dashboard` | `sha256:6e35c65cdb56c3334da3c2fe0f2fe1dc6a8589f5570bd2c6146e06bc9792db70` | amd64                  | 2026-09-08T17:56:24Z |
| `postgres:17`      | `sha256:67f41722b7a8cbdb868a44a4995c846eddfdc2973bccb291ce937dce88ad5675` | amd64                  | 2026-08-25T00:41:57Z |

The upstream project publishes only commit-SHA tags plus `latest` (569 tags, no semver), so
pinning **by digest** is the only reproducible option. The AWS deployment runs unpinned `:latest`.

> **Clarification (independent evaluator).** These digests are **OCI image indexes**
> (`application/vnd.oci.image.index.v1+json`), i.e. multi-arch manifest lists — verified. "amd64"
> above is the platform Docker resolved _on this host_, not a property of the pin. The same digest
> therefore also resolves on arm64, which is what makes a single pinned digest valid across the
> architecture change.

> **Correction (independent evaluator).** This section previously implied finding F-05 was fully
> resolved. Digest pinning fixes the _reproducibility_ half. The other symptom cited in F-05
> persists: `curl http://10.130.231.5:3210/version` on the destination still returns literally
> `unknown`, exactly as the source does. The backend simply does not report its version.

### Isolation

| Control                 | Implementation                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Compose project         | `convex-huawei` — shares nothing with `oploy-test`                                                                                     |
| Network                 | `convex-huawei-net`, dedicated bridge                                                                                                  |
| Volumes                 | `convex-huawei-pgdata`, `convex-huawei-convex-data`                                                                                    |
| **Postgres exposure**   | **not published to the host** — `docker ps` shows `5432/tcp` with no host mapping, so it is reachable only from the backend container  |
| Database                | dedicated Postgres, database `railway`, user `convex`, 40-char random password generated on the spot                                   |
| Source-safety assertion | the generated `.env` was asserted to contain no `rlwy.net` host and to match `postgresql://convex:…@postgres:5432` **before** transfer |

### Health, restart behaviour, persistence

```
convex-huawei-backend  state=running health=healthy restartPolicy=unless-stopped
convex-huawei-db       state=running health=healthy restartPolicy=unless-stopped
```

`depends_on … condition: service_healthy` orders Postgres before the backend. Both healthchecks
are real (`pg_isready`, `curl /version`), not sleeps. `stop_signal: SIGINT` +
`stop_grace_period: 10s` match upstream's own compose so the backend shuts down cleanly.

## 4. Deployment identity — deliberately preserved

`INSTANCE_NAME=railway` and `INSTANCE_SECRET` were copied **verbatim** from the AWS deployment.

This is not cosmetic. The backend derives its identity from `INSTANCE_SECRET`, and the existing
`CONVEX_SELF_HOSTED_ADMIN_KEY` only remains valid if both are preserved. Regenerating them would
invalidate the admin key and every deploy key derived from it. It was **verified empirically**:
the unchanged admin key authenticates against the Huawei backend.

Because `INSTANCE_NAME` is `railway`, the Postgres database must be named `railway` — the backend
appends the database itself (`POSTGRES_URL` deliberately carries no database name and no query
string, per Convex's own documentation). `POSTGRES_DB: railway` in compose creates it.

## 5. Known defect: the dashboard image is broken upstream

`convex-dashboard` starts but every request returns **HTTP 500**:

```
Error: Failed to load external module @radix-ui/react-icons-311a50637b01fce4:
Cannot find module '@radix-ui/react-icons-311a50637b01fce4'
```

This is a packaging fault in the published image, not a configuration error. **Three further
dashboard builds were pulled and probed individually — `7114be46…`, `e5e38a8a…`, `a21cba30…` —
and all three returned HTTP 500 as well.** It is not fixable by tag selection.

- **No regression:** the AWS dashboard is _also_ unavailable today (finding F-01), for a different
  reason (it sits behind a compose profile that never starts).
- **Administration is unaffected.** The Convex CLI provides full admin against the destination —
  `convex data`, `env`, `export`, `import`, `deploy`, `run`, `function-spec` all work with the
  admin key. Every administrative action in this migration was performed that way.
- Recorded as a decommissioning/follow-up item, not a blocker.

## 6. Public ingress — design PROVEN, named tunnel not yet built

> **Update 2026-09-10 (evening): the design is no longer theoretical.** A `cloudflared` quick
> tunnel (no Cloudflare account required) was run from the Huawei server, and from the Windows
> laptop over the public internet it returned **HTTP 200 with valid TLS** from Cloudflare edge
> `104.16.230.132` on `/version`, and **HTTP 101 Switching Protocols** on `/api/1.35.1/sync`.
> The WebSocket upgrade — the only genuinely uncertain part, and the thing Convex's client
> depends on — works through a Cloudflare tunnel. The tunnel was torn down immediately
> afterwards (the URL now returns 530), because it exposed a backend holding restored production
> data. See `activation-prep-log.md` §1.
>
> **Correction (independent evaluator, MIG-004 review).** An earlier version of this note and of
> `status.md` claimed "AC-14 is closed". **That was an overclaim and is withdrawn.** AC-14 reads
> "Public reachability path **exists** and is approved". What was demonstrated is _technical
> feasibility_, once, on an ephemeral randomly-named hostname that has since been dismantled — the
> evaluator independently measured `530` on that URL, `no cloudflared process running` on the host,
> and `convex-cloud.oploy.eu → 3.120.122.232` still served by AWS. **No public path to the Huawei
> backend presently exists. AC-14 = FAIL.** What remains is administrative — a _named_ tunnel and
> the hostname mapping — but until that exists the criterion is not met.

**This is the one part of the destination that cannot be completed without Mohammad.**

The Huawei server holds an RFC1918 address behind the **building's** NAT, on a router Mohammad
does not control. The registry already records: no UPnP/NAT-PMP client, no inbound port-forward,
and a hairpin test that proved nothing conclusive. **LAN success does not demonstrate public
reachability**, and production needs public reachability for:

| Consumer                                | Why it must reach the backend publicly                                  |
| --------------------------------------- | ----------------------------------------------------------------------- |
| Browsers on `jobpilot.oploy.eu`         | the Convex client opens a WebSocket straight from the visitor's browser |
| OAuth callbacks (Google, Gmail, OpenAI) | redirect URIs are registered against public hostnames                   |
| Resend webhook                          | Resend posts to `convex-site.oploy.eu/resend-webhook` from the internet |
| Integration API                         | `job-analytics-frontend` posts to `/api/integration/add-job`            |

### Proposal: Cloudflare Tunnel (`cloudflared`)

|                         |                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| How                     | a `cloudflared` container on Huawei opens an **outbound** connection to Cloudflare; Cloudflare routes `convex-cloud.oploy.eu` / `convex-site.oploy.eu` to it |
| Inbound firewall change | **none** — no port-forward, nothing new listening on the building network                                                                                    |
| DNS                     | `oploy.eu` is already on Cloudflare, so the records are already in the right place                                                                           |
| TLS                     | terminated by Cloudflare; a valid public certificate, no Let's Encrypt HTTP-01 challenge to arrange                                                          |
| Cost                    | free tier                                                                                                                                                    |
| WebSockets              | supported, which the Convex client requires                                                                                                                  |
| Rollback                | delete the tunnel route and repoint DNS at the AWS Elastic IP                                                                                                |

Alternatives considered and rejected: a router port-forward (Mohammad does not control the
router); Tailscale Funnel (does not serve a custom apex-subdomain cleanly, and every visitor's
browser must reach it); exposing the LAN IP publicly (impossible behind the building NAT).

**What this needs from Mohammad — it cannot proceed otherwise:**

1. Approval of a new public exposure arrangement for the Huawei server.
2. A Cloudflare login. Both Cloudflare MCP servers currently read **"Needs authentication"**, and
   neither `wrangler` nor `cloudflared` is installed on this Windows machine. Creating a tunnel and
   editing DNS both require authenticated Cloudflare access.

Until that exists, the destination is verified **on the LAN only**, and MIG-005 cannot start.

## 7. Security notes for the destination

| Item                                      | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ports `3210`/`3211`/`6791` bind `0.0.0.0` | Necessary for browser testing from the Windows laptop. It also means any device on the shared building WiFi can reach the backend, which now holds restored production data. This matches the posture already accepted for `oploy-test` (also holding a production copy) and Portainer, but it is a real exposure and should be narrowed — with `DOCKER-USER` rules, not `ufw`, because Docker's DNAT rules sit ahead of ufw's chain. |
| Postgres                                  | **Better than source.** Not published to the host at all; reachable only on the private bridge. Compare finding F-02, where production Postgres traffic crosses the public internet with no enforced TLS.                                                                                                                                                                                                                             |
| `.env` on the server                      | mode 600 in a mode-700 directory; never printed, never committed                                                                                                                                                                                                                                                                                                                                                                      |
| Secret transfer                           | assembled in the OS temp scratchpad, `scp`'d, then the local temp copy was deleted and its absence confirmed                                                                                                                                                                                                                                                                                                                          |
