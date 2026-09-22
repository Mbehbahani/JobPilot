# Final report — JobPilot Convex migration to the Huawei server

Run `20260910T153436Z-convex-huawei` · 2026-09-10

> **Headline: the migration is NOT complete.** A verified destination exists and is proven to work
> with real restored data, but JobPilot production still uses the old backend and the old database.
> Cutover has not been attempted and cannot be until a public ingress arrangement is approved.

---

## 1. What moved, and what still depends on Railway/AWS

### Moved — but only into a verified, isolated destination

| Component               | Now also running on Huawei                                                                 | Evidence                                            |
| ----------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Convex compute          | `convex-huawei-backend`, digest-pinned, healthy                                            | independently confirmed                             |
| Convex database         | dedicated Postgres 17 on an isolated bridge, database `railway`, not published to the host | 121 tables / 6,614 live documents                   |
| Convex data             | full snapshot restored                                                                     | **byte-identical**, 89 table paths, 3,114 documents |
| Deployed functions      | all 207, deployed from repo source                                                         | function-spec diff **identical**                    |
| Component-owned storage | working                                                                                    | file upload/download byte-compared                  |
| Scheduled work          | all 4 app crons registered                                                                 | deploy log                                          |

### Still on Railway / AWS — everything that matters for production

| Still there                        | Where                                                  | Consequence                                |
| ---------------------------------- | ------------------------------------------------------ | ------------------------------------------ |
| **The authoritative backend**      | AWS EC2 `i-03a95de5085f45cd6` @ `3.120.122.232`        | `jobpilot.oploy.eu` talks to it right now  |
| **The authoritative database**     | Railway Postgres, project `convex`                     | every real write still lands here          |
| Public routing                     | Cloudflare DNS → the AWS Elastic IP                    | unchanged                                  |
| Railway `Convex Backend` service   | no deployment, but still claims `convex-site.oploy.eu` | F-06, split-routing hazard                 |
| Railway `Convex Dashboard` service | stopped                                                | inert                                      |
| Railway TCP proxy                  | `kodama.proxy.rlwy.net:21648`                          | how AWS reaches the DB, unencrypted (F-02) |

**Nothing was deleted.** Candidates are listed in `decommissioning-list.md` for separate approval.

Unrelated AWS-backed features were not touched: the personal-search API Gateway, Supabase, PostHog,
and everything under `D:\AWS2\SupaBaseProject\` and `D:\AWS2\Wagtail\`. This was not a blanket
account migration. The frontend did not move.

---

## 2. The records were wrong — this is what is actually true

The Convex registry said the backend was self-hosted **on Railway**. The AWS runbook said it had
moved to **AWS with the database left on Railway**. Neither was taken on trust:

```
convex-backend-production-f015.up.railway.app/version → 404 "Application not found"  (dead)
convex-cloud.oploy.eu/version                          → 200 from 3.120.122.232       (AWS EIP)
jobpilot.oploy.eu served HTML                          → references convex-cloud.oploy.eu
```

**The AWS migration already happened.** `D:\Account Center\Convex\README.md` is materially wrong —
stamped 2026-09-07, only three days old, and still wrong. Correcting it is a follow-up; the Vault
and Account Center were not edited during this run.

---

## 3. Access instructions (no credentials here)

### The migrated application, today

Nothing to do — production is unchanged and reachable at `https://jobpilot.oploy.eu`.

### The verified destination (LAN only, from a device on `Glide_Resident`)

| Surface                               | Address                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Convex API (cloud origin)             | `http://10.130.231.5:3210`                                                  |
| HTTP actions / webhooks (site origin) | `http://10.130.231.5:3211`                                                  |
| Dashboard                             | `http://10.130.231.5:6791` — **broken, upstream image defect**              |
| Host admin                            | Cockpit `https://10.130.231.5:9090` · Portainer `https://10.130.231.5:9443` |

To run the app against it: build with `bunx vite build --mode huawei`, serve with
`bunx vite preview --mode huawei --port 4173`, open `http://localhost:4173`. Do **not** start
`bun run dev` — AGENTS.md forbids a second dev server.

### Administration

Via the Convex CLI with `CONVEX_SELF_HOSTED_URL=http://10.130.231.5:3210` and the existing admin
key from `infra/aws-convex/deploy/.env` (**unchanged by the migration — verified working**).
`convex data`, `env`, `export`, `import`, `deploy`, `run`, `function-spec` all work.

### Operations

| Task                       | Command (on the server, in `~/convex-huawei`)                                          |
| -------------------------- | -------------------------------------------------------------------------------------- |
| Start                      | `docker compose up -d`                                                                 |
| Stop                       | `docker compose stop`                                                                  |
| Restart                    | `docker compose restart`                                                               |
| Logs                       | `docker logs -f convex-huawei-backend`                                                 |
| Health                     | `docker inspect convex-huawei-backend --format '{{.State.Health.Status}}'`             |
| Backup                     | `convex export --include-file-storage --path <file>.zip`                               |
| Restore                    | `convex import --replace-all --yes <file>.zip`                                         |
| Verify a restore           | `python compare_snapshots.py <source>.zip <verify>.zip`                                |
| Fresh-volume restore drill | `docker compose -f docker-compose.restore-test.yml --env-file .env.restore-test up -d` |

Rollback commands are in `cutover-and-rollback.md` §4, split into before/after first write.

---

## 4. Checks: passed, failed, pending

### Passed

| Check                                        | Result                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Restore fidelity, source → destination       | 89 tables, 3,114 docs, **0 differences** — and all 155 raw archive entries byte-identical |
| Restore fidelity, backup → **fresh volumes** | identical result                                                                          |
| Function surface                             | 207 vs 207, **identical**                                                                 |
| Deployment env vars                          | 16 non-empty of 23 set; 7 empty in source skipped                                         |
| Migration verification suite                 | **8 / 8**                                                                                 |
| Project e2e suite                            | **40 / 42**                                                                               |
| Production build                             | PASS, targets Huawei only                                                                 |
| Unit tests                                   | 190 / 193                                                                                 |
| Container restart recovery                   | healthy in <10 s, 15 tables intact                                                        |
| Unrelated services preserved                 | Cockpit, Portainer, oploy-test all still 200                                              |
| Harness trusted check                        | pass, exit 0                                                                              |
| MCP cited query                              | 1 cited result, hash-matched, 5-citation context snapshot                                 |

### Failed

| Check                               | Assessment                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signin-last-used-badge.spec.ts:38` | App leaves `localStorage['auth:last-auth-method']` set after email sign-in. Assertion reads browser storage only; sign-in itself succeeded. **Not attributable to the migration**, but not confirmed against production either. |
| 3 email snapshot tests (F-11)       | **Pre-existing** — snapshots say "JobFlow", app says "JobPilot".                                                                                                                                                                |
| 19 type errors (F-12)               | **Pre-existing** — in 3 files, none modified by this work.                                                                                                                                                                      |
| Convex dashboard                    | HTTP 500. Upstream image defect; 4 published builds all fail. Not a regression.                                                                                                                                                 |

### Pending — deliberately not claimed as passing

Resend email · Autumn billing · Google OAuth · Gmail OAuth and actions · Unipile/webhooks ·
OpenAI/Codex/OpenRouter agent actions · Supabase personal search · Resend webhook signature ·
**public browser reachability** · cron _execution_ (registration is evidenced; a firing is not).

---

## 5. Independent evaluator verdicts

| Slice                                | Verdict                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| MIG-002 destination design           | **PASS**                                                                      |
| MIG-003 backup and isolated restore  | **PASS**                                                                      |
| Harness smoke cycle                  | **PASS** both criteria                                                        |
| **MIG-004 application verification** | **NOT COMPLETED — evaluator hit the session rate limit.** Review **PENDING**. |

The MIG-002/003 evaluator did not merely agree. It re-ran the comparison, then replaced the method
with a stricter one (SHA-256 of all 155 archive entries), checked the archives were not copies of
each other, corroborated the restore inside the destination Postgres, and found **seven
overclaims** — including "reproducible configuration lives in the repo" (it is untracked) and an
inverted causal story about why logical export/import was chosen. **All seven are corrected in the
reports**, each marked as an evaluator correction.

That matters for how to read MIG-004: generator self-assessment on this run was demonstrably
unreliable, so the unreviewed MIG-004 conclusions should be treated as claims with evidence
attached, not as verified results.

---

## 6. Backup, restore and rollback evidence

|                |                                                                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backup         | `convex export --include-file-storage`, read-only against production                                                                                                                         |
| Location       | `C:\Backups\jobpilot-convex\<run_id>\` — outside Git, outside `reports/`                                                                                                                     |
| SHA-256        | source `bf6755977d2145bf…` · destination re-export `3f7c4e8e1ff49846…` · fresh-volume re-export `a018a419afcc562b…`                                                                          |
| Includes       | all app tables **and** all component tables recursively, incl. Better Auth users/sessions                                                                                                    |
| Excludes       | function code (redeployed), env vars (re-set), pending scheduled jobs (none existed), index files (rebuilt)                                                                                  |
| Restore proven | twice — into the destination, and into an independent fresh-volume stack                                                                                                                     |
| Rollback       | defined **before and after** first write; the post-write path mandates exporting Huawei state _first_, and states plainly that returning to the source database discards post-cutover writes |

---

## 7. Remaining approvals and human checks

1. **Approve the public ingress** (Cloudflare Tunnel) — new public exposure of the home server.
2. **Authenticate Cloudflare** in a terminal — needed for DNS and the tunnel.
3. **Approve the cutover** after reading `cutover-and-rollback.md`.
4. **Approve AWS SSH ingress**, or accept `aws ec2 stop-instances`, to stop the source at cutover.
5. **Decide F-04** — add `unipile` to `convex.config.ts` or accept its removal.
6. **Release Railway's `convex-site.oploy.eu` domain claim** (F-06) before cutover.
7. **Re-dispatch the MIG-004 evaluator** once the session limit resets.
8. **`review-ack` for the synthetic Harness task** — the exact command is in
   `evaluator/harness-smoke-cycle-review.md` §5. **Not submitted on Mohammad's behalf.**

---

## 8. Report location

```
D:\AWS2\JobPilot\reports\migration\20260910T153436Z-convex-huawei\
├── status.md · plan.md · decisions.md
├── problems-and-recovery.md · effort-and-usage.md
├── cutover-and-rollback.md · decommissioning-list.md
├── evidence-manifest.json · final-report.md
├── slices/    MIG-001 … MIG-004
├── evaluator/ MIG-002-003 verdict · MIG-004 (pending) · Harness smoke cycle
└── evidence/  env names · zip index · restore comparisons · function specs · checksums
```

Sensitive backups are **not** in this directory. They are in
`C:\Backups\jobpilot-convex\20260910T153436Z-convex-huawei\`, referenced only by checksum.

---

## 9. The honest bottom line

A destination that holds a byte-identical copy of production and demonstrably runs the real
application — sign-in against real restored users, board CRUD, realtime across two browsers, file
round-trip, access isolation, restart recovery, and a from-scratch restore — now exists on the
Huawei server.

It has been proven **on the LAN**. It has **not** been proven reachable by the public internet, and
that is the one thing standing between this and a real cutover. No amount of further local testing
can close it: it needs an approved ingress arrangement and a Cloudflare login.

**JobPilot still uses the old backend and the old database. The migration is not complete, and
nothing in this report should be read as saying otherwise.**
