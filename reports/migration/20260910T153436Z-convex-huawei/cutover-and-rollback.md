# Cutover and rollback plan — for approval

Run `20260910T153436Z-convex-huawei` · **NOT EXECUTED. Awaiting Mohammad's approval.**

This is the MIG-005 plan. Nothing in it has been run. It is written so that the exact commands,
the expected downtime, and the rollback are all visible **before** any decision.

---

## 0. What must be true before cutover starts

| #   | Prerequisite                                                               | Status                                                                                                        |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| P-1 | Isolated destination verified                                              | **DONE** — MIG-002/003/004                                                                                    |
| P-2 | **Public ingress approved and built**                                      | **BLOCKED — needs Mohammad**                                                                                  |
| P-3 | Cloudflare access to edit DNS / create a tunnel                            | **BLOCKED** — both Cloudflare MCP servers read "Needs authentication"; `wrangler`/`cloudflared` not installed |
| P-4 | F-04 settled: the `unipile` component drift                                | **OPEN** — decide whether to add it to `convex.config.ts` or accept its removal                               |
| P-5 | F-06 settled: Railway's stale `convex-site.oploy.eu` domain claim released | **OPEN** — split-routing hazard                                                                               |
| P-6 | Decide the fate of `DO_NOT_REQUIRE_SSL` / F-02                             | **OPEN** — resolved for the destination, but worth a conscious decision                                       |
| P-7 | Mohammad's explicit cutover approval                                       | **NOT GIVEN**                                                                                                 |

**P-2 is the hard blocker.** Everything verified so far was verified over the LAN. The Huawei
server has a private address behind the building's NAT on a router Mohammad does not control.
Browsers on `jobpilot.oploy.eu`, Google's OAuth callback, and Resend's webhook sender all reach the
backend from the public internet. A LAN-only backend cannot serve them.

---

## 1. Proposed ingress (must be approved before anything below runs)

Cloudflare Tunnel, running as a container on Huawei:

- Opens an **outbound** connection to Cloudflare. No port-forward. Nothing new listens on the
  building network. No inbound firewall change on a router Mohammad does not own.
- `oploy.eu` is already a Cloudflare zone, so the DNS records are already in the right place.
- Cloudflare terminates TLS with a valid public certificate — no Let's Encrypt HTTP-01 challenge
  to arrange, and no dependency on the proxied/unproxied distinction that bit the AWS migration.
- Supports WebSockets, which the Convex client requires.
- Free tier.

Hostname mapping:

| Public hostname         | Tunnel target           |
| ----------------------- | ----------------------- |
| `convex-cloud.oploy.eu` | `http://localhost:3210` |
| `convex-site.oploy.eu`  | `http://localhost:3211` |

**This is a new public exposure of Mohammad's home server.** It is the thing to say yes or no to.

---

## 2. Expected downtime

| Phase                               | Expected                                         | Worst case                                |
| ----------------------------------- | ------------------------------------------------ | ----------------------------------------- |
| Quiesce + final export from AWS     | 1–3 min                                          | 10 min if the snapshot is slow            |
| Import into Huawei                  | ~10 s (3,049 documents took 5 s)                 | 1 min                                     |
| DNS repoint + propagation           | 1–5 min (Cloudflare-proxied records update fast) | 30+ min for clients honouring a stale TTL |
| Smoke checks                        | 5 min                                            | —                                         |
| **Total user-visible interruption** | **roughly 10–20 minutes**                        | up to ~45 min                             |

**Set the DNS TTL to 60 s at least an hour before cutover** so the propagation window is short and
the rollback is equally short. This is the single highest-leverage preparation step.

Downtime is **not zero and cannot be**: exactly one backend may own the database at a time, so
this is a stop-the-old / start-the-new handoff, not a live A/B switch.

---

## 3. Cutover sequence

Every step is reversible until step 6.

### Step 1 — Freeze (T-60 min)

- Lower TTL on `convex-cloud.oploy.eu` and `convex-site.oploy.eu` to 60 s.
- Announce the window. No deploys during it.

### Step 2 — Quiesce writers on the source

The source has no maintenance mode, so quiescing means stopping the things that write:

- **Scheduled work**: crons live in deployed code, so the only way to stop them is to stop the
  backend. They are therefore stopped at step 4, not before.
- **Inbound webhooks**: Resend and the integration API arrive at `convex-site.oploy.eu`. They stop
  when the source backend stops.
- **Human writers**: this is the part to announce. Users mid-session will see errors during the
  window.

### Step 3 — Final consistent transfer

```bash
cd D:\AWS2\JobPilot
# read-only against the source
CONVEX_SELF_HOSTED_URL=https://convex-cloud.oploy.eu \
CONVEX_SELF_HOSTED_ADMIN_KEY=<from infra/aws-convex/deploy/.env> \
  ./node_modules/.bin/convex export --include-file-storage \
    --path C:\Backups\jobpilot-convex\cutover-<ts>\final-snapshot.zip

sha256sum C:\Backups\jobpilot-convex\cutover-<ts>\final-snapshot.zip
```

### Step 4 — Stop the source backend

```bash
ssh -i infra/aws-convex/convex-aws-migration.pem ec2-user@3.120.122.232 \
  'cd ~/convex-deploy && docker compose stop backend'
```

(Requires the AWS security-group SSH rule that was denied earlier — **this must be resolved before
cutover**, or the source must be stopped another way. See "Open problem" below.)

From this moment the source is down. The clock is running.

### Step 5 — Import into Huawei and validate

```bash
CONVEX_SELF_HOSTED_URL=http://10.130.231.5:3210 \
CONVEX_SELF_HOSTED_ADMIN_KEY=<same key> \
  ./node_modules/.bin/convex import --replace-all --yes \
    C:\Backups\jobpilot-convex\cutover-<ts>\final-snapshot.zip

# re-export and compare, exactly as in MIG-003
./node_modules/.bin/convex export --include-file-storage --path <...>\post-cutover-verify.zip
python <scratchpad>\compare_snapshots.py <...>\final-snapshot.zip <...>\post-cutover-verify.zip
```

**Gate: the comparison must report `VERDICT: PASS`.** If it does not, roll back at step R-A.

### Step 6 — Point the destination at its public identity ← **last reversible-without-data-loss step**

```bash
# on Huawei, in ~/convex-huawei/.env
CONVEX_CLOUD_ORIGIN=https://convex-cloud.oploy.eu
CONVEX_SITE_ORIGIN=https://convex-site.oploy.eu
# and restore production values:
SITE_URL=https://jobpilot.oploy.eu
BETTER_AUTH_TRUSTED_ORIGINS=https://jobpilot.oploy.eu,http://localhost:5173,http://127.0.0.1:5173
RESEND_API_KEY / RESEND_WEBHOOK_SECRET / AUTUMN_SECRET_KEY  ← restore the REAL values
AUTH_E2E_TEST_SECRET  ← REMOVE
docker compose up -d
```

### Step 7 — Switch routing

- Repoint `convex-cloud.oploy.eu` and `convex-site.oploy.eu` at the Cloudflare Tunnel.
- **Exactly one authoritative destination.** The source backend is already stopped (step 4); do not
  restart it while DNS points at Huawei.

### Step 8 — Frontend

`PUBLIC_CONVEX_URL` is baked in at build time and already equals `https://convex-cloud.oploy.eu`,
so **no frontend redeploy is required** — the hostname is unchanged, only what it points to. This
is a meaningful advantage over the AWS migration, which had to change the variable.

### Step 9 — Production smoke checks with a designated test account

Not HTTP 200. Actual behaviour, in a real browser:

1. Sign in as the designated test account; session persists across a reload.
2. A pre-existing board loads with its pre-existing tasks.
3. Create, update and delete one task; confirm persistence after reload.
4. Two browser sessions; realtime propagation between them.
5. Upload and download one file.
6. Confirm the Convex WebSocket connects to `wss://convex-cloud.oploy.eu`, not the AWS IP.
7. Confirm no request in DevTools goes to `3.120.122.232`.

**If any gate fails → rollback (§4).**

---

## 4. Rollback

The rollback differs before and after new writes land on Huawei. This distinction matters more
than anything else in this document.

### R-A — Before step 6 (no new writes on Huawei yet)

Clean and lossless.

1. Do not change DNS (it still points at AWS).
2. Restart the source backend:
   `ssh ec2-user@3.120.122.232 'cd ~/convex-deploy && docker compose start backend'`
3. Confirm `https://convex-cloud.oploy.eu/version` returns 200 from `3.120.122.232`.
4. Leave the Huawei stack running or stop it; either way it is not authoritative.

**Data loss: none.** The source database was never modified.

### R-B — After step 7, once real users have written to Huawei

**⚠️ This is the dangerous one. Returning to the source database silently discards every write
made on Huawei since cutover.** The source Railway Postgres is frozen at the step-3 snapshot; it
has no knowledge of anything that happened afterwards.

Therefore rollback after new writes is **not** "put DNS back". It is:

1. **Stop the Huawei backend first.** `docker compose stop backend` on Huawei. This freezes the
   authoritative dataset and prevents split-brain.
2. **Export the Huawei state before doing anything else:**
   ```bash
   CONVEX_SELF_HOSTED_URL=http://10.130.231.5:3210 ... \
     convex export --include-file-storage --path <...>\rollback-huawei-state.zip
   ```
   _(Do this even in a panic. It is the only copy of the post-cutover writes.)_
3. Repoint DNS back to `3.120.122.232`.
4. Restart the AWS backend.
5. **Accept, consciously and in writing, that the writes in `rollback-huawei-state.zip` are now
   missing from the live system**, and decide separately how to reconcile them. There is no
   automatic merge: Convex has no cross-deployment merge, and re-importing the Huawei snapshot over
   the source would discard anything written on AWS after the restart.

**Decision rule:** if a gate fails at step 9 _before_ any real user has written, prefer R-A —
stop Huawei, restart AWS, no reconciliation needed. R-B is only for a failure discovered later.

### Split-brain prevention

- Only one backend may hold the Postgres connection. The source and destination use **different**
  databases (source: Railway Postgres; destination: local Postgres on Huawei), so they cannot
  corrupt each other — but they _can_ both accept writes if both are running and something still
  routes to each. Hence: **stop the old backend before repointing DNS, and never restart it while
  DNS points at Huawei.**
- **Stale DNS caches are the real split-brain risk.** For up to the old TTL, some clients will keep
  resolving to `3.120.122.232`. Because the source backend is stopped at step 4, those clients get
  a connection failure rather than writing to a stale database. That is the intended behaviour and
  the reason step 4 precedes step 7.
- **Duplicate background effects:** while both stacks run, both would run the same four crons and
  the same workpools. Only one may be running. The source backend being stopped handles this.
- **F-06 must be closed first:** Railway still holds a custom-domain claim on `convex-site.oploy.eu`
  for a service with no deployment. If that service were ever redeployed, it could contend for the
  hostname. Release the claim before cutover.

---

## 5. Open problem that must be solved before cutover

**Stopping the source backend requires SSH to the EC2 instance, and that access does not currently
work.** `sg-07789c8d3a90f8788` allows port 22 only from `80.113.56.156/32`, a stale address; the
current operator IP is `80.113.2.188`. The attempt to add the current IP was **denied by the host
permission classifier**.

Options, in order of preference:

1. Mohammad adds the SSH rule himself in the AWS console, or approves the CLI call.
2. Stop the instance entirely via `aws ec2 stop-instances` (no SSH needed) — blunter, but it does
   stop the backend, and the instance can be started again for rollback. Note this also stops
   Caddy, so the old hostnames stop answering immediately rather than serving an error.
3. Use AWS SSM Session Manager — **not available**: the instance has no IAM instance profile.

Option 2 is viable as a fallback and preserves rollback, since stopping an instance is reversible
and the EBS volume and Elastic IP association survive.

---

## 6. Explicitly not part of cutover

- **No deletion of anything.** No old service, volume, snapshot, database or cloud resource is
  removed. The AWS instance, its EBS volume, the Elastic IP, and the Railway Postgres all stay.
  A separate decommissioning list needs separate approval.
- **The frontend does not move.** It stays where it is; only what its baked-in hostname resolves to
  changes.
- **Unrelated AWS-backed features stay put** — the personal-search API Gateway
  (`dctvnm5py6.execute-api.eu-central-1.amazonaws.com`), Supabase, PostHog and the rest are
  untouched.
