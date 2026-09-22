# Status

Run `20260910T153436Z-convex-huawei` · last updated 2026-09-10

## One line

**PRODUCTION MIGRATED (2026-09-11 ~11:49 UTC).** `jobpilot.oploy.eu` is served by the Ubuntu
backend through a Cloudflare named tunnel; the AWS instance is **stopped**. Live-site browser smoke
passes. One human check remains: Mohammad signing in with his own account. See `cutover-log.md`.

## The three states, kept separate

| State                                        | Applies to                                                                                                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ Isolated destination verified             | The Huawei stack holds a byte-identical restore of production data, serves the real application correctly over the LAN, and passes 8/8 migration checks plus 40/42 of the project's own e2e suite. |
| ✅ Cutover approved and **executed**         | Named tunnel `jobpilot-convex`, DNS switched 11:48:46Z, fidelity gate PASS.                                                                                                                        |
| ✅ **Production migrated** / ⏳ **verified** | Migrated: yes — browser opens `wss://convex-cloud.oploy.eu` → Ubuntu; nothing reaches `3.120.122.232`. Verified: automated smoke passes; **authenticated check by Mohammad still pending**.        |

## Slice status

| Slice                                            | Generator                 | Independent evaluator                      | Notes                                                                                                                                                         |
| ------------------------------------------------ | ------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MIG-001 Inventory and baseline                   | PASS                      | folded into MIG-002/003 review             | Established the live topology by probe; both records were wrong or stale                                                                                      |
| MIG-002 Destination and recovery design          | PASS                      | **PASS**                                   | 7 overclaims found and corrected; dashboard broken upstream                                                                                                   |
| MIG-003 Backup and isolated restore              | PASS                      | **PASS**                                   | Byte-identical restore, re-verified at a stricter standard than the generator used                                                                            |
| MIG-004 Application integration and verification | PASS (claimed)            | **REVIEWED — DOES NOT PASS at revision 1** | AC-6/7/8/9/10/11 confirmed PASS; **AC-12 PARTIAL**; **AC-14 FAIL**. One generator overclaim found and corrected. See `evaluator/MIG-004-evaluator-verdict.md` |
| MIG-005 Reviewed production cutover              | **NOT STARTED — BLOCKED** | —                                          | Needs public ingress + approval                                                                                                                               |
| MIG-006 Handover                                 | PARTIAL                   | —                                          | Everything except the public-access demonstration                                                                                                             |
| Harness smoke cycle                              | PASS                      | **PASS**                                   | Finalize **blocked on human acknowledgment**, correctly                                                                                                       |

## What is blocking

Updated after the activation-preparation pass (2026-09-10, later the same day).

| #   | Blocker                                                                                                                                                                                          | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Who can clear it                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| B-1 | **Public ingress for Huawei**                                                                                                                                                                    | **STILL BLOCKING. Feasibility proven; no path exists.** `cloudflared 2026.9.0` installed; a quick tunnel returned HTTP 200 + valid TLS and **HTTP 101 on the WebSocket endpoint** from the public internet — which settles the one genuinely uncertain question, that Cloudflare's edge proxies Convex's `Upgrade` handshake. But that tunnel was **torn down**, no named tunnel exists, and `convex-cloud.oploy.eu` still resolves to the AWS EIP. **AC-14 is NOT closed.** | **Mohammad** — named tunnel + hostname mapping                              |
| B-2 | **Cloudflare named tunnel + hostname mapping**                                                                                                                                                   | **STILL BLOCKING — the only remaining blocker.** No usable credential exists on this machine: both MCP servers need browser OAuth, `wrangler` is not installed and needs the same, and no API token is stored.                                                                                                                                                                                                                                                               | **Mohammad** — browser login; the tunnel token must never pass through chat |
| B-7 | **F-06 stale Railway domain claim** — confirmed **ACTIVE** (`convex-site.oploy.eu`, id `0b0dcd52-…`, port 3211) on a service with no deployment                                                  | `railway domain delete` was **denied by the permission classifier**, not by Railway — the CLI is authenticated and would have succeeded                                                                                                                                                                                                                                                                                                                                      | **Mohammad** — run it himself, or add a Bash permission rule                |
| B-3 | **Cutover approval**                                                                                                                                                                             | **GIVEN**                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                           |
| B-4 | **Stopping the source backend at cutover**                                                                                                                                                       | **RESOLVED with a caveat.** `aws ec2 stop-instances` / `start-instances` both dry-run successfully, and the Elastic IP stays associated across stop/start, so rollback works. The SG-rule route (preferred, surgical) was **denied again** by the permission classifier.                                                                                                                                                                                                     | **Mohammad** — run the SG command himself for Option A, or accept Option B  |
| B-5 | **MIG-004 independent review**                                                                                                                                                                   | **DONE.** Verdict: does not pass at revision 1 — AC-14 fails, AC-12 partial. Both blocking findings acted on: the AC-14 overclaim withdrawn, and the fresh-volume restore re-run and **left in place** on port 3220 for live verification.                                                                                                                                                                                                                                   | —                                                                           |
| B-8 | **Host reboot never observed** — the restart policy has never fired (`RestartCount=0`) and the box has not rebooted since the stack was deployed, so durability across a power cycle is unproven | A reboot was attempted and **denied by the permission classifier**                                                                                                                                                                                                                                                                                                                                                                                                           | **Mohammad** — reboot the server, or permit it                              |
| B-6 | **Harness `review-ack`** for the synthetic smoke task                                                                                                                                            | **STILL PENDING**                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Mohammad** — I will not submit this on his behalf                         |

## Activation-prep findings (2026-09-10, later pass)

The expectation was that Google OAuth, Netlify env vars, and Resend would all need changing.
**Verified: they do not.** Only Cloudflare routing changes.

| Finding                                                                                                                                                                                                                                                                                    | Evidence                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| **The frontend is on Netlify, not Vercel.** Site `jobpilot-eu` (`940d4565-dee8-42a6-a04b-b5fc4a16ea6c`), team `front`, behind Cloudflare. `vercel.json` in the repo is **stale** — new finding **F-13**.                                                                                   | `x-nf-request-id` header; `netlify sites:list` |
| **No Netlify change and no redeploy needed.** `PUBLIC_CONVEX_URL=https://convex-cloud.oploy.eu`, `PUBLIC_CONVEX_SITE_URL=https://convex-site.oploy.eu` — hostnames, not IPs.                                                                                                               | `netlify env:list`                             |
| **Zero hardcoded `3.120.122.232`** in any Netlify environment.                                                                                                                                                                                                                             | `grep -c` → 0                                  |
| **No Google Cloud Console change needed.** Better Auth's `baseURL` is `SITE_URL` = `https://jobpilot.oploy.eu`, so callbacks stay on a host that is not migrating.                                                                                                                         | `auth.ts`, `env.ts`                            |
| **No Resend change needed.** Webhook targets `https://convex-site.oploy.eu/resend-webhook` — hostname unchanged.                                                                                                                                                                           | `http.ts`                                      |
| **`job.oploy.eu` unaffected** — its `PROMUS_CONVEX_SITE_URL` is also a hostname.                                                                                                                                                                                                           | `netlify env:list`                             |
| `convex-cloud` / `convex-site` are **DNS-only (grey cloud)** A records → `3.120.122.232`. **These are the rollback values.** Cloudflare will replace them with tunnel CNAMEs.                                                                                                              | resolved IPs                                   |
| **F-14 (new, low):** Netlify has `SITE_URL=http://jobpilot.oploy.eu` and `EMAIL_ASSET_URL=http://jobpilot.oploy.eu` (**http**) while the Convex deployment has `https`. Inconsistent; not breaking production today. Do **not** change it during cutover — separate change, separate risk. | `netlify env:list`                             |
| **F-15 (new, low):** `OPENROUTER_API_KEY` is set on Netlify but **not** on either Convex deployment, though `supportLlmProvider = 'openrouter'` is consumed by Convex actions. Support-LLM features are likely already non-functional in production. Pre-existing.                         | env name lists                                 |

### Self-inflicted issue found and fixed in this pass

The first dry-run of `activate-production-env.sh` **printed live credential values** to the
terminal, because its dry-run branch echoed the whole command including the secret argument. Fixed
so it prints only the action and variable name; a leak check (`grep -cE 're_|whsec_|am_sk_live'`)
now returns **0**. The values appeared only in Mohammad's own terminal on his own machine and were
never written to a file, committed, or sent anywhere — but rotating those three keys would be a
reasonable precaution.

## Open findings not yet resolved

| ID          | Finding                                                                                                                 | Severity                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| F-02        | Production DB traffic crosses the public internet with no enforced TLS                                                  | **High** — resolved on the destination, still true of the source |
| F-04        | Deployed source has a `unipile` component the repo does not declare; it is now unmounted on the destination             | Medium — **decide before cutover**                               |
| F-06        | Railway still holds a custom-domain claim on `convex-site.oploy.eu`                                                     | Medium — **release before cutover**                              |
| F-01 / P-12 | Convex dashboard unavailable on both source and destination (different causes; destination is an upstream image defect) | Medium                                                           |
| F-07 / F-08 | Local env files still point at the dead Railway URL                                                                     | Medium                                                           |
| F-09        | Admin keys pasted as free-text notes in `.env.convex.local`                                                             | Medium                                                           |
| F-11 / F-12 | 3 stale email snapshots, 19 pre-existing type errors                                                                    | Low                                                              |
| —           | `infra/huawei-convex/` is untracked in Git                                                                              | Low — committing is Mohammad's call                              |

## Current live state

|                           |                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------- |
| Production backend        | AWS EC2 `i-03a95de5085f45cd6` @ `3.120.122.232` — **untouched and serving**         |
| Production database       | Railway Postgres, project `convex` — **untouched and authoritative**                |
| Destination               | `convex-huawei` on `10.130.231.5` — backend + db healthy, dashboard broken upstream |
| Unrelated Huawei services | Cockpit, Portainer, `oploy-test-app`, `oploy-test-db` — all verified still running  |
| Backups                   | 3 archives, checksummed, in `C:\Backups\jobpilot-convex\<run_id>\`                  |
| Deleted                   | **Nothing.** No service, volume, snapshot, database or cloud resource was removed.  |

## Resuming after an interruption

Durable state is: the running Huawei stack; the checksummed archives; `infra/huawei-convex/` in the
working tree; this report directory; and the Harness SQLite ledger (attempt
`attempt_92b6f9d42f89411084f94bd9e775fdf5`, review `review_52c9938e6fdf4bc6a4797ab7ee9fe5cd`).
None of the completed work needs repeating.
