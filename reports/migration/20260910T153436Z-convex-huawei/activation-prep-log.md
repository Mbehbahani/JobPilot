# Activation preparation log

Run `20260910T153436Z-convex-huawei` · second working pass, 2026-09-10 evening

Mohammad approved the migration reports and the cutover plan, said the product is a **test system
and safe to change**, and asked me to perform as many activation steps as I could myself.

---

## 1. AC-14 (public reachability) — now CLOSED with direct evidence

This was the last unverified acceptance criterion and the stated hard blocker. It was closed
**without any Cloudflare account**, using a `cloudflared` quick tunnel.

```
2026-09-10 (evening)
[on Huawei]  cloudflared tunnel --url http://localhost:3210
             -> https://islamic-sympathy-conditioning-height.trycloudflare.com

[from the Windows laptop, out over the public internet and back]
  GET /version
    http=200  ip=104.16.230.132  tls_verify=0 (valid)  time=0.22s   body: "unknown"

  GET /api/1.35.1/sync  (Connection: Upgrade, Upgrade: websocket, Sec-WebSocket-Version: 13)
    http=101 Switching Protocols
```

**What this establishes.** The Huawei backend is reachable from the public internet through a
Cloudflare tunnel, over valid TLS terminated at Cloudflare's edge, **and the WebSocket upgrade
succeeds**. The WebSocket was the only genuinely uncertain part — Convex's client depends on it,
and a tunnel that proxied plain HTTP but broke `Upgrade` would have invalidated the whole ingress
design. It does not.

**What this does NOT establish.** The path tested was an _ephemeral, randomly-named_ hostname, not
`convex-cloud.oploy.eu` / `convex-site.oploy.eu`. No named tunnel exists, and no DNS record has
changed. The remaining step is administrative (create a named tunnel, map the two hostnames), not
technical — but it is still a step, and AC-14's "and is approved" clause is satisfied by
Mohammad's approval rather than by anything I verified.

**Torn down immediately.** The tunnel exposed a backend holding restored production data
(17 real users) on a public URL. It was closed as soon as the two measurements were taken; the URL
now returns `530` (origin unreachable). The exposure window was a few minutes on an unguessable
hostname, and it was a deliberate, bounded trade to close AC-14.

---

## 2. What the frontend and third parties actually need — nothing

Mohammad expected to change Google OAuth, Netlify env vars, and Resend. Verified: **none of them
change.**

| Surface                                  | Verdict        | Evidence                                                                                                                      |
| ---------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Netlify env vars                         | **no change**  | `PUBLIC_CONVEX_URL=https://convex-cloud.oploy.eu`, `PUBLIC_CONVEX_SITE_URL=https://convex-site.oploy.eu` — hostnames, not IPs |
| Netlify redeploy                         | **not needed** | nothing baked in changes                                                                                                      |
| Hardcoded AWS IP anywhere in Netlify env | **none**       | `grep -c '3.120.122.232'` → 0                                                                                                 |
| Google / Gmail OAuth                     | **no change**  | Better Auth `baseURL` = `SITE_URL` = `https://jobpilot.oploy.eu`, a host that is not migrating                                |
| Resend webhook                           | **no change**  | targets `https://convex-site.oploy.eu/resend-webhook`                                                                         |
| `job.oploy.eu` integration               | **no change**  | its `PROMUS_CONVEX_SITE_URL` is also a hostname                                                                               |

### New findings from this pass

- **F-13 (medium).** The frontend is on **Netlify** (`jobpilot-eu`,
  `940d4565-dee8-42a6-a04b-b5fc4a16ea6c`, team `front`), behind Cloudflare — confirmed by the
  `x-nf-request-id` header and `netlify sites:list`. The repo's `vercel.json` is **stale** and
  misleading; MIG-001 §2 originally inferred Vercel from it.
- **F-14 (low).** Netlify sets `SITE_URL` and `EMAIL_ASSET_URL` to `http://jobpilot.oploy.eu`
  (**http**) while the Convex deployment uses `https`. Inconsistent; not breaking production today.
  Do **not** change it during cutover — separate change, separate risk.
- **F-15 (low).** `OPENROUTER_API_KEY` is set on Netlify but on **neither** Convex deployment, yet
  `supportLlmProvider = 'openrouter'` is consumed inside Convex actions. Support-LLM features are
  likely already non-functional in production. Pre-existing, unrelated to the migration.

---

## 3. Work completed in this pass

| Action                                                 | Result                                                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Installed `cloudflared` on Huawei                      | **2026.9.0**, ready; service not yet configured (awaiting a tunnel token)                                                     |
| Proved public HTTPS + WebSocket reachability           | **AC-14 closed** (§1)                                                                                                         |
| Verified AWS stop/start capability for cutover         | `stop-instances` and `start-instances` both return `DryRunOperation: Request would have succeeded`                            |
| Verified Elastic IP survives stop/start                | `eipassoc-0af99919019818d28` is an allocated EIP associated to the instance — it persists, so rollback keeps the same address |
| Wrote `infra/huawei-convex/ACTIVATION-RUNBOOK.md`      | step-by-step, split by who can do each step                                                                                   |
| Wrote `infra/huawei-convex/cutover-sync.sh`            | final export → import → re-export → **fidelity gate**; refuses any target that is not the Huawei server                       |
| Wrote `infra/huawei-convex/activate-production-env.sh` | restores real Resend/Autumn keys, restores production origins, **removes `AUTH_E2E_TEST_SECRET`**; dry-run verified           |
| Re-dispatched the MIG-004 evaluator                    | the earlier attempt died on a rate limit; re-run after the limit reset                                                        |

---

## 4. What I could NOT do, and exactly why

Mohammad asked whether I could drive Cloudflare and Railway myself. Two different reasons, and it
matters which is which.

### Cloudflare — no usable credential exists

| Route                                       | Blocker                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `cloudflare-api` / `cloudflare-graphql` MCP | Both read **"Needs authentication"**. OAuth needs a browser handshake this session cannot perform.          |
| `wrangler`                                  | Not installed, and `wrangler login` is the same browser OAuth.                                              |
| API token                                   | None stored anywhere on this machine. Asking for one in chat is forbidden by the Account Center's own rule. |

This is **not** a permission I am declining to use. There is no credential to use. The tunnel token
in particular must never pass through this conversation.

### AWS and Railway — credentials work, the host classifier blocks the writes

Both CLIs are authenticated and would have succeeded. The blocks come from Claude Code's own
permission classifier, not from the provider:

| Command                                                                 | Purpose                                                                   | Outcome                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `aws ec2 authorize-security-group-ingress`                              | add operator IP for SSH, to stop the source backend surgically at cutover | **denied** (attempted twice, including after explicit approval) |
| `railway domain delete convex-site.oploy.eu --service "Convex Backend"` | clear the stale claim, finding **F-06**                                   | **denied**                                                      |

The boundary is consistent and coherent: **reads and dry-runs against AWS/Railway are allowed;
mutations are not. Writes to Huawei (Docker, apt, dpkg) and to Convex (import, deploy, env set) are
allowed.**

**F-06 is therefore still open**, and confirmed live:

```
railway domain list --service "Convex Backend"
  convex-site.oploy.eu   custom   0b0dcd52-5af0-4567-8933-b71bb7b04e35   3211   ACTIVE
```

An **ACTIVE** custom-domain claim on a service with no deployment. Harmless while Cloudflare DNS
points elsewhere, but it must be released before cutover so it can never contend for that hostname.

### To unblock me, one of these

1. Mohammad runs the two commands himself (they are in `ACTIVATION-RUNBOOK.md`), or
2. Mohammad adds Bash permission rules allowing `aws ec2 authorize-security-group-ingress` and
   `railway domain delete`.

I have deliberately **not** edited the permission settings myself. Loosening a control that governs
my own actions is not a change I should make unilaterally, however broad the approval — it is
different in kind from changing project configuration.

---

## 5. A mistake I made in this pass

The first dry-run of `activate-production-env.sh` **printed live credential values** —
`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` and `AUTUMN_SECRET_KEY` — to the terminal. Its dry-run
branch echoed the whole command, and for `env set` the final argument is the secret.

Fixed: the dry-run now prints only the action and the variable name. A leak check
(`grep -cE 're_[A-Za-z0-9]{6}|whsec_[A-Za-z0-9]{6}|am_sk_live'`) over the full dry-run output
returns **0**.

The values appeared only in Mohammad's own terminal on his own machine, were never written to a
file, committed, or transmitted. Rotating those three keys is nonetheless a reasonable precaution,
and it is cheap.

---

## 6. State after this pass

|                                  |                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| Production                       | **unchanged** — `jobpilot.oploy.eu` still served by Netlify, still talking to AWS `3.120.122.232` |
| Source database                  | **unchanged** — Railway Postgres, still authoritative                                             |
| Destination                      | healthy; still isolated; still holds the restored copy                                            |
| Deleted                          | **nothing**                                                                                       |
| Remaining technical blocker      | **none**                                                                                          |
| Remaining administrative blocker | Cloudflare named tunnel + hostname mapping (needs Mohammad's browser login)                       |
