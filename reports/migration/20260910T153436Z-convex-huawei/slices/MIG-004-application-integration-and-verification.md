# MIG-004 — Application integration and verification

Status: **PASS with recorded pendings** · awaiting independent evaluator

## 1. How the app was pointed at Huawei without disturbing anything

`PUBLIC_CONVEX_URL` is read through `$env/static/public`, so it is **baked in at build time** —
a runtime override would not have worked. An isolated Vite build mode was created rather than
editing the project's existing env files:

- `.env.huawei.local` (gitignored by the existing `*.local*` rule) sets the Huawei URLs.
- Built with `vite build --mode huawei`. Vite precedence puts `.env.huawei.local` above
  `.env.local`, so the stale Railway URL (finding F-07) cannot leak in.
- Served with `vite preview --mode huawei --port 4173`.

**AGENTS.md line 36 — "NEVER use `bun run dev` … it's already running in a separate terminal" — was
respected.** No dev server was started. A production build served on port 4173 was used instead,
and the project's own Playwright config (which would have started `dev:frontend` on 5173) was
bypassed with `CI=1`, not edited.

### Proof the build actually targets Huawei

```
client bundle:  http://10.130.231.5:3210
server bundle:  http://10.130.231.5:3210 , http://10.130.231.5:3211
```

No `convex-cloud.oploy.eu`, no Railway URL anywhere in the output. The verification suite also
asserts `PUBLIC_CONVEX_URL` contains `10.130.231.5` in `beforeAll`, so it cannot silently run
against production.

## 2. Static and build checks

| Check            | Command                    | Result                                                                        |
| ---------------- | -------------------------- | ----------------------------------------------------------------------------- |
| Production build | `vite build --mode huawei` | **PASS** — built in 1m 8s                                                     |
| Unit tests       | `bun run test:unit`        | 190 passed, **3 failed** — all pre-existing (F-11)                            |
| Type check       | `bun run check`            | 14,898 files, **19 errors / 8 warnings in 3 files** — all pre-existing (F-12) |

**F-11 — email snapshot tests (pre-existing).** `src/lib/emails/__tests__/email-snapshots.test.ts`
fails 3 snapshots. The committed snapshots still say **"JobFlow"**; the app now renders
**"JobPilot"** with a different design token set. This is a stale snapshot from an un-updated
rebrand. No backend involvement whatsoever.

**F-12 — type errors (pre-existing).** All 19 are in `src/blocks/hero/pipeline-demo.svelte`,
`src/lib/components/RiveBackground.svelte`, and
`src/routes/[[lang]]/app/my-job-search/+page.svelte`. **No file under `src/` was modified by this
migration** (`git status` shows only `.mcp.json` changed plus new untracked directories), so these
cannot be regressions from this work.

`adapter-auto` reports "Could not detect a supported production environment" locally. Expected —
the project deploys via Vercel; `vite preview` serves the build regardless.

## 3. The project's own e2e suite, run against Huawei

`CI=1 bunx playwright test` — **40 passed, 1 failed, 1 not run.**

Passing coverage worth naming, because it exercises real restored data:

| Area                                        | Evidence                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sign-in (regular + admin)                   | both setup projects passed                                                                                                                             |
| Unauthenticated redirect                    | `invalid-auth.spec.ts` passed                                                                                                                          |
| Authenticated vs unauthenticated API access | route handler returns 200 / 403 correctly                                                                                                              |
| Forgot / reset password flows               | 7 tests passed                                                                                                                                         |
| Support ticket migration                    | **migrated 105 anonymous tickets and verified database reassignment**                                                                                  |
| Admin users table                           | 10 tests — search, role/status filters, cursor pagination, deep-page refresh, sort, URL state hydration, jump-to-last-page — all against restored data |
| Admin settings                              | 7 tests including add/remove recipient and duplicate detection                                                                                         |

**The one failure — `signin-last-used-badge.spec.ts:38` — is not a migration regression.**
After a successful email/password sign-in the app leaves `localStorage['auth:last-auth-method']`
set to `"google"` instead of clearing it. Sign-in itself succeeded (the test got past
`waitForAuthenticated`); the failing assertion reads **browser localStorage only** and has no
backend dependency in its path. It is an app-side bug. It was **not** confirmed against production,
because doing so would mean creating test users on the live deployment — so it is recorded as
_not attributable to this migration_, needing a production comparison before being called
pre-existing with certainty.

`signout.spec.ts` did not run because Playwright's project dependency chain skipped it after the
failure above. Sign-out is covered instead by verification test 8 below, which passes.

`AUTH_E2E_TEST_SECRET` was empty on production, so this suite had never been runnable against it;
it was generated fresh and set **only on the isolated Huawei deployment**, which is exactly where a
test secret belongs. Test users are created per run with unique addresses and deleted by
`globalTeardown` — confirmed running in every execution.

## 4. Migration verification suite — 8/8 pass

`e2e/_migration-verify.spec.ts`, run via `playwright.migration.config.ts` (a separate config that
starts no dev server and reuses the project's real global setup/teardown).

| #   | Test                                     | Result   | What it actually proves                                                                                                                                                                    |
| --- | ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Sign-in, session, board query            | **PASS** | Authenticated Convex query resolves against Huawei; board returns columns `applied, done, interviewing, preparing, targeted`                                                               |
| 2   | Session persists across full reload      | **PASS** | Session survives a reload, not just a SPA transition                                                                                                                                       |
| 3   | HTTP action creates a task               | **PASS** | `POST 10.130.231.5:3211/api/integration/add-job` → 200; row read back through an authenticated query                                                                                       |
| 4   | **Realtime across two browser sessions** | **PASS** | Two independent browser contexts, both signed in, **neither reloaded**; a row written through the site origin appears in **both** within 30 s — i.e. over the Convex WebSocket from Huawei |
| 5   | Update and delete persist                | **PASS** | `todos:saveBoard` mutation round-trips: title updated then removed, each confirmed by re-query                                                                                             |
| 6   | Access isolation between users           | **PASS** | A second signed-in user's board does **not** contain the first user's task                                                                                                                 |
| 7   | File upload/download round-trip          | **PASS** | `generateUploadUrl` → POST 1×1 PNG → `saveUploadedFile` → download; **downloaded bytes byte-compared equal to uploaded bytes**; URL host is `10.130.231.5:3210`                            |
| 8   | Sign-out                                 | **PASS** | Sign-out through the app's own UI; session null; `convex_jwt` cleared; protected route bounces to `/signin`                                                                                |

Test 7 first failed correctly, and the failure is worth keeping: uploading `text/plain` was
rejected with _"File type not allowed. Supported: PNG, JPEG, WebP, GIF, PDF"_ — the
`convexFilesControl` component enforcing its policy on the destination. Re-run with a real PNG, it
passes. Component-owned storage works even though the migrated store was empty.

Every record these tests create is owned by a freshly created e2e user and removed afterwards.

## 5. A real defect found and fixed — in my own configuration, not the migration

Browser sign-in initially failed: `POST /api/auth/sign-in/email` returned **200 with a valid
token and JWT**, yet the following `GET /api/auth/get-session` returned `null` and cleared the JWT
cookie. Diagnosis, in order:

1. WebSocket to `ws://10.130.231.5:3210/api/1.35.1/sync` **opened fine** — transport was healthy.
2. `BETTER_AUTH_SECRET` was compared by SHA-256 across the local file, the Huawei deployment and
   production: **all three identical**. Not the cause — and incidentally a fidelity check that the
   migration preserved the auth secret.
3. Reading `src/routes/api/auth/[...all]/+server.ts` found the cause. That route carries a
   deliberate localhost shim which assumes the **upstream `SITE_URL` is HTTPS**, so Better Auth
   issues `__Secure-`-prefixed cookies; the shim renames them for a plain-HTTP localhost frontend
   and renames them back on the way in. I had retargeted `SITE_URL` to `http://localhost:4173`,
   which made Better Auth issue **unprefixed** cookies — so the shim rewrote the browser's
   `better-auth.session_token` to `__Secure-better-auth.session_token` on the way upstream, where
   nothing was looking for it.

Fixed by restoring the production-shaped `SITE_URL=https://jobpilot.oploy.eu` and adding
`http://localhost:4173` to `BETTER_AUTH_TRUSTED_ORIGINS`. Production already trusts
`http://localhost:5173` for exactly this workflow, confirming the pattern is intended. Sign-in then
completed to `/en/app/my-tasks`.

**This was my error, introduced during test setup — not a migration defect and not an app defect.**

## 6. Restart recovery and fresh-volume restore

```
2026-09-10T16:25:08Z  docker compose restart  (all three containers)
2026-09-10T16:25:17Z  backend healthy again — under 10 seconds
```

| After restart           |                                                             |
| ----------------------- | ----------------------------------------------------------- |
| `convex-huawei-backend` | `state=running health=healthy restartPolicy=unless-stopped` |
| `convex-huawei-db`      | `state=running health=healthy restartPolicy=unless-stopped` |
| Tables                  | 15 before, **15 after**                                     |

Restore into a fresh, independent volume set is covered in MIG-003 §7 — **PASS**, byte-identical.

## 7. Scheduled and background work

All four application crons registered on the destination at deploy time:

```
Crons Added: [cleanupExpiredFiles, deleteEmptyThreads, deleteUnusedFiles, recoverStaleTasks]
Crons Added: [recover]                (resend/emailWorkpool)
Crons Added: [recover]                (resend/callbackWorkpool)
Crons Added: [Cleanup expired runs]   (convexFilesControl/actionRetrier)
```

The backend logs `Starting cron job executor` and `Starting scheduled job executor` on every boot.

**Honest limit:** cron _registration_ and the executor starting are directly evidenced. An
individual cron _firing_ was **not** directly observed — `_cron_jobs`, `_cron_job_logs` and
`_scheduled_functions` all read empty through the CLI, and these crons are cleanup jobs with no
externally visible effect on this dataset. Recorded as **partially verified**, not passed.

## 8. Explicitly pending — deliberately not claimed as passing

| Integration                               | Status      | Why                                                                                                                             |
| ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Resend email delivery                     | **PENDING** | API key deliberately inert. No email may be sent without specific authorization.                                                |
| Autumn billing                            | **PENDING** | Secret key deliberately inert. No billable action taken.                                                                        |
| Google OAuth sign-in                      | **PENDING** | Redirect URIs are registered for public hostnames; untestable from `localhost:4173` without registering a new callback.         |
| Gmail OAuth + Gmail actions               | **PENDING** | Same callback constraint; would also touch a real mailbox.                                                                      |
| Unipile / webhook                         | **PENDING** | Requires a real inbound webhook from a third party. Also see F-04: the `unipile` component is now unmounted on the destination. |
| OpenAI / Codex / OpenRouter agent actions | **PENDING** | No LLM provider key set on either deployment; agent actions cannot complete on source or destination.                           |
| Supabase personal search                  | **PENDING** | Credentials copied, path not exercised.                                                                                         |
| Resend inbound webhook signature          | **PENDING** | Secret intentionally wrong on the destination.                                                                                  |
| Public browser reachability               | **BLOCKED** | Requires the ingress arrangement in MIG-002 §6 and Mohammad's approval.                                                         |

## 9. Verification scope limit, stated plainly

Everything above was verified over the **LAN**, from the Windows laptop's browser to
`10.130.231.5`. That demonstrates the migrated backend serves the real application correctly with
real restored data. It does **not** demonstrate that public visitors, OAuth providers, or webhook
senders can reach it — and it cannot, until the ingress in MIG-002 §6 is approved and built.
