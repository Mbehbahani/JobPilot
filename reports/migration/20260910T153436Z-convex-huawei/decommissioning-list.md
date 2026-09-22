# Decommissioning candidates — for later approval

Run `20260910T153436Z-convex-huawei`

**Nothing on this list has been deleted, stopped or modified.** It exists so that a future,
separately approved cleanup has an accurate starting point. Do not act on it until the cutover has
succeeded and a rollback window has passed.

## Do NOT touch until well after a successful cutover

| #   | Resource                                                      | Why it must stay for now                                                                                                            |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | EC2 `i-03a95de5085f45cd6` (`t4g.small`, eu-central-1b)        | The rollback target. Stopping it is reversible; terminating it is not.                                                              |
| 2   | EBS volume `vol-032bdf0739a4902e1` (gp3, 30 GB)               | Holds `/convex/data` — deployed modules and search indexes for the source.                                                          |
| 3   | Elastic IP `eipalloc-08ad0bb1031a91ed8` (`3.120.122.232`)     | The rollback DNS target. **Note: an unattached Elastic IP starts billing**, so release it only when the instance is genuinely gone. |
| 4   | **Railway Postgres** (project `convex`, service `b16b2337-…`) | **The live production database.** It remains authoritative until cutover completes and is the rollback dataset afterwards.          |
| 5   | `C:\Backups\jobpilot-convex\20260910T153436Z-convex-huawei\`  | The verified backups. Keep.                                                                                                         |

## Safe to clean up once cutover is confirmed

| #   | Resource                                             | Action                    | Notes                                                                                                                                                                                     |
| --- | ---------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | Railway service `Convex Backend` (`e3018eb8-…`)      | delete service            | Already has no deployment. **Its custom-domain claim on `convex-site.oploy.eu` should be released _before_ cutover**, not after — see F-06, split-routing hazard.                         |
| 7   | Railway service `Convex Dashboard` (`dab48a38-…`)    | delete service            | `deploymentStopped: true`. Unused.                                                                                                                                                        |
| 8   | Railway TCP proxy `kodama.proxy.rlwy.net:21648`      | remove                    | Only exists to expose Postgres to AWS. Once Convex runs on Huawei with a local database, this public exposure of the production DB has no purpose. Closing it also resolves finding F-02. |
| 9   | AWS security group rule: SSH from `80.113.56.156/32` | remove                    | Stale operator IP.                                                                                                                                                                        |
| 10  | Terraform state in `infra/aws-convex/`               | keep, but mark superseded | Records real infrastructure; do not delete while the instance exists.                                                                                                                     |

## Created by this run — clean up when the run is closed out

| #   | Item                                                                   | Where               | Action                                                                                                                   |
| --- | ---------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 11  | `AUTH_E2E_TEST_SECRET` on the Huawei deployment                        | Convex env          | **Remove before cutover.** It enables `tests:verifyTestUserEmail` and `tests:createTestAdminUser`.                       |
| 12  | `.env.test`                                                            | `D:\AWS2\JobPilot\` | delete after the run (gitignored)                                                                                        |
| 13  | `.env.huawei.local`                                                    | `D:\AWS2\JobPilot\` | delete after the run (gitignored)                                                                                        |
| 14  | `.mcp.json.bak-premigration`                                           | `D:\AWS2\JobPilot\` | delete once the MCP merge is accepted                                                                                    |
| 15  | `e2e/_migration-verify.spec.ts`, `playwright.migration.config.ts`      | `D:\AWS2\JobPilot\` | **Worth keeping.** They are a reusable backend-migration acceptance suite. Keep or delete deliberately, not by accident. |
| 16  | `~/convex-huawei/.env.restore-test`, `docker-compose.restore-test.yml` | Huawei server       | keep — they are the documented restore-verification procedure                                                            |
| 17  | Harness synthetic sources `migration-smoke`, `migration-smoke-shared`  | Harness runtime     | deregister when the run is closed out; they point at the OS temp scratchpad                                              |
| 18  | `dash-probe` container                                                 | Huawei              | already removed after each probe                                                                                         |

## Explicitly NOT decommissioning candidates

These are unrelated to the Convex migration and must be left alone. This was **not** a blanket
migration of the AWS account.

- API Gateway `dctvnm5py6.execute-api.eu-central-1.amazonaws.com` (personal search)
- Supabase project `gzlwizgipclhelnoogmr`
- Everything under `D:\AWS2\SupaBaseProject\` and `D:\AWS2\Wagtail\`
- Cloudflare zone `oploy.eu` and the Wagtail/Railway production site
- On the Huawei server: Cockpit, Portainer, `oploy-test-app`, `oploy-test-db`, and the
  `portainer_data` / `oploy-test` volumes
