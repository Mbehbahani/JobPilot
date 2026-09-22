# Activation runbook — switching JobPilot to the Huawei backend

Companion to `reports/migration/20260910T153436Z-convex-huawei/cutover-and-rollback.md`.
This is the operational checklist.

---

## The good news first: almost nothing needs changing

The migration was expected to touch Google OAuth, Netlify env vars, Resend, and Cloudflare
routing. **Verified on 2026-09-10: only Cloudflare routing actually changes.**

| Thing you expected to change     | Verdict                                                             | Why                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Netlify env vars**             | **NO CHANGE**                                                       | `PUBLIC_CONVEX_URL=https://convex-cloud.oploy.eu` and `PUBLIC_CONVEX_SITE_URL=https://convex-site.oploy.eu` are **hostnames**, not IPs. Repointing DNS is invisible to them.                                                                 |
| **Netlify redeploy**             | **NOT NEEDED**                                                      | Nothing the build bakes in changes.                                                                                                                                                                                                          |
| **Google OAuth (Cloud Console)** | **NO CHANGE**                                                       | Better Auth's `baseURL` is `SITE_URL` = `https://jobpilot.oploy.eu`, so the callback is `https://jobpilot.oploy.eu/api/auth/callback/google`. That host is not migrating. Gmail's callback (`/api/auth/gmail/callback`) is on the same host. |
| **Resend webhook URL**           | **NO CHANGE**                                                       | It targets `https://convex-site.oploy.eu/resend-webhook` — hostname unchanged.                                                                                                                                                               |
| **`job.oploy.eu` integration**   | **NO CHANGE**                                                       | Its `PROMUS_CONVEX_SITE_URL` is also the hostname.                                                                                                                                                                                           |
| **Convex env vars**              | **CHANGE** — but on the Huawei deployment only, at cutover (step 7) |
| **Cloudflare DNS**               | **CHANGE** — this is the actual cutover                             |

There are **zero hardcoded references to `3.120.122.232`** in any Netlify environment
(`grep -c` → 0).

---

## Roles

| Symbol | Meaning                                                                   |
| ------ | ------------------------------------------------------------------------- |
| 👤     | **You must do this** — needs a browser login or a permission I don't have |
| 🤖     | I can do this                                                             |

---

## PHASE 0 — Prepare (no user impact, do any time)

### 0.1 👤 Lower the DNS TTL — do this ≥1 hour before cutover

In Cloudflare → `oploy.eu` → DNS, set **TTL = 1 min** (or Auto) on:

- `convex-cloud` (A → `3.120.122.232`, DNS-only / grey cloud)
- `convex-site` (A → `3.120.122.232`, DNS-only / grey cloud)

> **Write these two values down.** They are the rollback target. Cloudflare will _replace_ these
> A records with tunnel CNAMEs, and you will need to recreate them by hand to roll back.

### 0.2 ✅ `cloudflared` is already installed on the Huawei server

`cloudflared version 2026.9.0` — installed 2026-09-10. Nothing to do.

### 0.3 👤 Create the tunnel (Cloudflare login required)

1. Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**
2. Type: **Cloudflared**. Name it `jobpilot-convex`.
3. Cloudflare shows an install command containing a **token**.
4. **You run that command yourself** on the Huawei server — in your own terminal, not in chat.
   I must never handle that token.

   ```bash
   ssh sohamoha@10.130.231.5
   # paste the command Cloudflare gave you, which looks like:
   sudo cloudflared service install eyJhIjoi...
   ```

5. Confirm it registers: the dashboard should show the connector **HEALTHY**.

### 0.4 👤 Add TEMPORARY public hostnames — NOT the live ones yet

Still in the tunnel's **Public Hostname** tab, add these two. Using temporary names lets us prove
public reachability **without touching live routing**:

| Subdomain             | Domain     | Service                   |
| --------------------- | ---------- | ------------------------- |
| `convex-cloud-huawei` | `oploy.eu` | `HTTP` → `localhost:3210` |
| `convex-site-huawei`  | `oploy.eu` | `HTTP` → `localhost:3211` |

> ⚠️ Do **not** add `convex-cloud` / `convex-site` yet. Adding those overwrites the live DNS
> records and switches production instantly — before the data is synced.

### 0.5 🤖 I verify public reachability

I'll confirm from the public internet that the tunnel serves the Huawei backend, and that the
WebSocket upgrade works. **This closes AC-14**, the last unverified acceptance criterion.

### 0.6 👤 Decide how the source backend gets stopped

Pick one:

**Option A (preferred — surgical).** Give me SSH to the EC2 host so I can stop only the backend
container. Run this yourself, in a terminal:

```bash
aws ec2 authorize-security-group-ingress --group-id sg-07789c8d3a90f8788 --region eu-central-1 \
  --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=80.113.2.188/32,Description='cutover'}]" \
  --profile mohabehb
```

Rollback is then instant: `docker compose start backend`.

**Option B (fallback — already permitted, no action needed).** I stop the whole instance with
`aws ec2 stop-instances`. Verified I have permission, and the Elastic IP stays associated across
stop/start, so rollback is `aws ec2 start-instances`.

> Option A is preferred because Option B's rollback depends on Docker and the containers coming
> back automatically at boot. That is _likely_ (`restart: unless-stopped`, and the instance's
> user-data enabled Docker at boot) but **has never been observed**, and I cannot verify it without
> rebooting production.

---

## PHASE 1 — Cutover (this is the downtime window, ~10–20 min)

### 1.1 👤 Announce the window

Users mid-session will see errors. No deploys during the window.

### 1.2 🤖 Quiesce and stop the source backend

Option A: `docker compose stop backend` over SSH. Option B: `aws ec2 stop-instances`.
Crons, webhooks and all writes stop here. **The clock starts.**

### 1.3 🤖 Final consistent transfer

`convex export --include-file-storage` from the source, checksummed.
(Only possible with Option A, or before the instance stops with Option B — see note below.)

> ⚠️ **Option B ordering caveat:** stopping the instance also stops Caddy, so the export must be
> taken _immediately before_ the stop. There is a small window where a write could land after the
> export and before the stop. Option A avoids this: the export is taken, then only the backend
> container is stopped. **This is the strongest argument for Option A.**

### 1.4 🤖 Import into Huawei and verify

`convex import --replace-all`, then re-export and compare table-by-table.
**Gate: the comparison must report `VERDICT: PASS`.** If not → rollback.

### 1.5 🤖 Restore production settings on the Huawei deployment

Scripted in `activate-production-env.sh`. It restores the **real** `RESEND_API_KEY`,
`RESEND_WEBHOOK_SECRET` and `AUTUMN_SECRET_KEY` (currently inert placeholders), restores
`BETTER_AUTH_TRUSTED_ORIGINS` to production values, **removes `AUTH_E2E_TEST_SECRET`**, and sets
`CONVEX_CLOUD_ORIGIN` / `CONVEX_SITE_ORIGIN` to the live hostnames.

> This is deliberately the **last** step before routing. Until now the destination physically
> cannot send email or bill anyone.

### 1.5b 🤖 REQUIRED: redeploy functions after changing the origins

**Missed at the 2026-09-11 cutover — cost ~25 minutes of "I can't see my data".**
`auth.config.ts` uses `getAuthConfigProvider()`, which bakes the accepted JWT issuer from
`CONVEX_SITE_URL` **at deploy time**. Functions deployed while the origin was the LAN address keep
expecting `http://10.130.231.5:3211` as issuer; after the origin changes to
`https://convex-site.oploy.eu`, every JWT is rejected with _"No auth provider found matching the
given token"_. Sessions still appear valid (pages load) but every Convex query runs unauthenticated:
boards look empty, ChatGPT/Gmail connections fail.

Fix: after `docker compose up -d` with the new origins, run `convex deploy` against the destination
once more. Then verify with `docker logs … | grep -c 'No auth provider found'` → 0 after a real
sign-in.

### 1.6 👤 Switch routing — the actual cutover

In the tunnel's **Public Hostname** tab, add:

| Subdomain      | Domain     | Service                   |
| -------------- | ---------- | ------------------------- |
| `convex-cloud` | `oploy.eu` | `HTTP` → `localhost:3210` |
| `convex-site`  | `oploy.eu` | `HTTP` → `localhost:3211` |

Cloudflare will warn that it is replacing the existing A records. That is the switch.
You may delete the two temporary `-huawei` hostnames afterwards.

### 1.6b 👤 REQUIRED: exempt the backend hostnames from Cloudflare bot protection

Learned the hard way at cutover (2026-09-11). Making `convex-*` proxied puts Cloudflare's bot
protection in front of an API that **Netlify calls server-to-server** from datacenter IPs.
Cloudflare answers those with a "Just a moment…" challenge page; the Convex client expects JSON
and throws → every SSR page that touches Convex returns **500**. Browsers are unaffected, which
makes it easy to miss.

In the `oploy.eu` zone:

1. **Security → Bots → Bot Fight Mode → Off** (Free plan: cannot be scoped per host).
2. **Security → WAF → Custom rules → Create**: name `allow-convex-api`, expression
   `(http.host eq "convex-cloud.oploy.eu") or (http.host eq "convex-site.oploy.eu")`,
   action **Skip**, tick every skip option offered. Deploy.

**This is permanent.** Netlify SSR, Resend's webhook sender and the `job.oploy.eu` integration all
depend on it. Never remove it.

### 1.7 🤖 Production smoke checks

Real browser, designated test account: sign-in, session persists across reload, an existing board
loads with existing tasks, create/update/delete a task, realtime across two windows, file
upload/download, and DevTools confirms **no request goes to `3.120.122.232`**.

### 1.8 👤 Watch for a while

Keep the source instance stopped but **not deleted** for at least a few days.

---

## PHASE 2 — Rollback, if a gate fails

### Before step 1.6 (routing not yet switched) — clean, no data loss

Restart the source backend. DNS never moved. Nothing was written to Huawei by real users.

### After step 1.6, once real users have written — ⚠️ read carefully

Returning to the source database **silently discards every write made on Huawei since cutover.**

1. 🤖 **Stop the Huawei backend first** — freezes the authoritative dataset, prevents split-brain.
2. 🤖 **Export Huawei state before anything else.** It is the only copy of the post-cutover writes.
3. 👤 In Cloudflare, delete the `convex-cloud` / `convex-site` tunnel hostnames and **recreate the
   A records**: both → `3.120.122.232`, **DNS-only (grey cloud)**.
   > Grey cloud matters: the AWS box runs Caddy with Let's Encrypt, and a proxied record breaks the
   > HTTP-01 challenge.
4. 🤖 Restart the source backend / instance.
5. 👤 Decide separately how to reconcile the exported Huawei writes. There is no automatic merge.

---

## Before you start — two open decisions

1. **F-04, the `unipile` component.** The deployed source carries a `unipile` component that
   `src/lib/convex/convex.config.ts` does not declare. It is empty (0 rows), and the Huawei
   deployment has already dropped it. Confirm that is fine, or add it back to `convex.config.ts`.
2. **F-06, Railway's stale domain claim.** Railway's `Convex Backend` service still claims
   `convex-site.oploy.eu` despite having no deployment. Release it in the Railway dashboard before
   cutover, so it can never contend for that hostname.
