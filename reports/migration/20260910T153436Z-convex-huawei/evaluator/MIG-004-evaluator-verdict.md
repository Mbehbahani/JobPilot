# Independent evaluator verdict — MIG-004

Acceptance revision **1** · evaluated 2026-09-10 (second attempt) · distinct native subagent context

> A first evaluator was dispatched earlier and **terminated on a session rate limit** before
> producing any verdict. This is the completed re-run.

**Independence disclosure.** Native subagent, fresh context, same task and acceptance revision.
Per `agent-work.md`, native agent identity is **evidence of a separate context, not cryptographic
isolation**; no host attestation mechanism is installed, so this review is **supervised, not
attested**. It made no writes to production (`convex-cloud.oploy.eu` touched only by `env list`,
`env get`, `function-spec` — all read-only), no writes to the destination, no edits to product
code or tests, and printed **no secret value** — only SHA-256 digests, lengths and prefix booleans.

---

## VERDICT: **MIG-004 does NOT pass at acceptance revision 1**

Six criteria confirmed PASS, one PARTIAL, one FAIL.

| Criterion                                             | Verdict                                | Evidence the evaluator observed itself                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC-6** function parity                              | **PASS**                               | Re-derived both specs live: **207 = 207**, sorted identifier/type/visibility sets **byte-identical**. The _entire_ JSON difference between the two deployments is the `url` field. Stored evidence files also byte-identical (`sha256 4d600f07…`).                                                                                                                           |
| **AC-7** env vars set                                 | **PASS**, naming caveat                | Destination has **17** names; source has 23, of which **7 are empty**. 16 non-empty + `AUTH_E2E_TEST_SECRET` = 17. **The generator's accounting holds exactly.**                                                                                                                                                                                                             |
| **AC-8** side effects neutralised                     | **PASS** (ordering sub-clause unknown) | Digest comparison: `RESEND_API_KEY`, `AUTUMN_SECRET_KEY`, `RESEND_WEBHOOK_SECRET` all **DIFFER** from source. Controls prove the method discriminates: `BETTER_AUTH_SECRET`, `SITE_URL`, `AUTH_GOOGLE_SECRET` all **IDENTICAL**. 6h of backend logs contain **no send attempt and no 401**.                                                                                  |
| **AC-9** sign-in / sign-out / persistence             | **PASS**                               | Re-ran tests 1, 2, 8. Sign-out goes through the app's own logout button, then asserts null session, empty JWT cookie, and redirect from a protected route.                                                                                                                                                                                                                   |
| **AC-10** CRUD + realtime                             | **PASS**                               | Tests 3, 4, 5 passed in its own run. See rigour analysis below.                                                                                                                                                                                                                                                                                                              |
| **AC-11** file round-trip                             | **PASS**                               | Test 7 passed; assertion is a real `Buffer.compare(...) === 0`.                                                                                                                                                                                                                                                                                                              |
| **AC-12** restart recovery **+** fresh-volume restore | **PARTIAL**                            | Leg 1 confirmed live (`running healthy unless-stopped RestartCount=0`, `StartedAt 16:25:10Z` matching the recorded restart). Leg 2 was **not reproducible** — the test volumes had been deleted, leaving only a generator-authored text file. Also: `RestartCount=0` means the restart policy has **never fired**, and `uptime` showed **no host reboot has ever occurred**. |
| **AC-14** public reachability                         | **FAIL as worded**                     | Measured `530` on the quick-tunnel URL, `no cloudflared process running` on the host, `convex-cloud.oploy.eu → 3.120.122.232` still served by AWS. **No public path to Huawei presently exists.**                                                                                                                                                                            |

### Its own re-run of the suite

```
8 passed (48.9s)   EXIT=0
```

Plus a check the generator did not make: it fetched the built chunk **from the live preview
server** (`curl localhost:4173/_app/immutable/chunks/O_49Wz2e.js | grep 10.130.231.5:3210` → hit),
proving the server actually serving the tests serves the Huawei-targeted build rather than a stale
artifact on disk. `grep -rlF 'convex-cloud.oploy.eu' .svelte-kit/output` → **zero hits**.

---

## Test rigour — the most valuable part of this review

The evaluator read the suite before running it and chased the reactivity question into app source.

| Test                    | Judgement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4 — realtime**        | **GENUINE.** Neither page is reloaded; the write is issued out-of-band via `APIRequestContext`, touching no DOM and triggering no SvelteKit invalidation. It verified the consumer is a live subscription — `kanban-board.svelte:54` uses `useQuery` from `convex-svelte` — and grepped that component for `setInterval`/`refetchInterval`/`poll`: **no matches**. So the only mechanism that can deliver the title to page B is the Convex websocket. _Nit: the 30s timeout would have tolerated a slow poll had one existed, so the design leans on the app not polling rather than proving it._ |
| **6 — isolation**       | **NOT vacuous, but weaker than implied.** It _does_ assert user A has the record before asserting user B lacks it, so the "both boards empty" failure mode is excluded. But user B is a freshly created admin whose board is empty by construction. It catches the loud failure (a `getBoard` ignoring caller identity) but **is a scoping smoke check, not an authorization test, and should not be cited as one.**                                                                                                                                                                               |
| **7 — file round-trip** | **GENUINE, strictest in the suite.** Real byte comparison, plus it asserts the upload URL contains `10.130.231.5` so it cannot silently round-trip through production storage. _Nit: 70-byte payload exercises nothing about large or multi-chunk files._                                                                                                                                                                                                                                                                                                                                          |
| **5 — CRUD**            | **GENUINE.** Verifies _absence_ after update and after delete, not just presence. _Nit: "delete" is a whole-board `saveBoard` replacement rather than a dedicated delete path._                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **1**                   | **Weakest.** `expect(board).toBeTruthy()` passes on `{}`. Tests 3 and 5 compensate. Should assert a known column key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

It also credited two real guards: the `beforeAll` hard assertion that both URLs contain
`10.130.231.5` (making it impossible to run against production), and per-run unique test users
deleted by `globalTeardown` — both of which it observed executing.

---

## Blocking findings, and what was done about them

### B-1 — AC-14 overclaimed in `status.md` → **CORRECTED**

`status.md` said _"APPROVED, and now PROVEN … AC-14 closed."_ The evaluator called this wrong
against the criterion's wording ("path **exists** and is approved"), because the demonstrated path
was ephemeral, randomly named, and dismantled.

It noted the contradiction precisely: `activation-prep-log.md` §1 states the limitation accurately
and even concedes the "approved" clause rests on Mohammad's approval rather than verification —
**the overclaim was confined to the summary, which contradicted the detailed log it summarised.**

**Repair applied:** `status.md` B-1 and the MIG-002 §6 note now read _feasibility proven, path does
not exist, AC-14 = FAIL_. The withdrawal is recorded in both places rather than silently edited.

### B-2 — fresh-volume restore not independently reproducible → **REPAIRED**

The evaluator could not re-derive AC-12's second leg because the test volumes had been destroyed
(`down -v`), leaving only a generator-authored text file — a required `unknown` under the rubric.

**Repair applied 2026-09-10T18:19Z:** the fresh-volume restore was **re-run and left in place**.

```
convex-restore-test-backend  Up (healthy)   port 3220
convex-restore-test-db       Up (healthy)
volumes: convex-restore-test-pgdata, convex-restore-test-convex-data   ← retained

import  → Added 3049 documents
compare → 89 tables · 3114/3114 · 0 missing · 0 extra · 0 mismatches · VERDICT: PASS
```

The stack is still running on port 3220 and both volumes still exist, so this leg is now
**independently verifiable live** rather than on trust. Evidence:
`evidence/fresh-volume-restore-comparison.txt`.

**Still open within AC-12:** no host reboot has ever been observed, so durability across a power
cycle — the failure mode that actually matters for a laptop on building WiFi — remains unproven.
An attempt to reboot the server was **denied by the host permission classifier**. This needs
Mohammad to reboot the box, or to permit it.

---

## Non-blocking findings

1. **AC-7 name parity is 17/23, not 23/23.** Behaviourally equivalent (the 6 absent names are
   empty on source), but the AC text should be reworded to "all non-empty deployment env vars".
2. **AC-6 has a blind spot the report does not name.** `function-spec` compares _functions_, not
   _components_ — so **F-04 (the undeclared `unipile` component) is invisible to it.** "Function
   list matches" must not be read as "the deployments are equivalent".
3. **`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` are live-identical to production** on the isolated
   deployment. Outside AC-8's named set and practically inert (redirect URIs don't cover the test
   origin), but the isolated box does hold working OAuth client credentials.
4. **"Before first start" in AC-8 is unverifiable post-hoc** — only the current state and the
   absence of any send attempt in the log window can be shown.
5. **The quick tunnel exposed restored production data.** The evaluator raises this as a judgement
   call the owner should be told was made: approval to "perform activation steps" on "a test
   system" is not obviously specific consent to publish restored production personal data on a
   public URL, even briefly. It was disclosed, bounded, and torn down. Flagged, not called a
   violation.
6. Test 1 should assert a known column key rather than truthiness.
7. The project's own 40/42 e2e suite was **not** re-run by this evaluator (out of brief); that
   count remains generator-reported.

---

## What the generator overclaimed

**Exactly one thing, in one place:** `status.md`'s "AC-14 closed."

Claims the evaluator actively tried to falsify and **could not**: 207-function parity, the 16+1 env
accounting, the three neutralised secrets, the Huawei-targeted bundle, the 8/8 suite result, the
190/3 unit-test split, the 19-errors/3-files type check, and the restart-recovery container state.

> "The MIG-004 slice report's own §7, §8 and §9 (crons 'partially verified', integrations
> 'PENDING', the LAN-only scope limit) are honest and, if anything, stricter than they needed to
> be. This is a markedly better-calibrated report than the MIG-002/003 pair that drew seven
> corrections."

---

## Where MIG-004 stands after the repairs

| Criterion                            | Before review  | After repairs                                                                              |
| ------------------------------------ | -------------- | ------------------------------------------------------------------------------------------ |
| AC-6, AC-7, AC-8, AC-9, AC-10, AC-11 | claimed pass   | **PASS (independently confirmed)**                                                         |
| AC-12                                | claimed pass   | **PARTIAL** — fresh-volume leg now reproducible live; **host reboot still never observed** |
| AC-14                                | claimed closed | **FAIL** — withdrawn and corrected                                                         |

**MIG-004 remains NOT PASSED at acceptance revision 1**, because AC-14 fails and AC-12 is partial.
That is the correct state: the destination is genuinely verified over the LAN, and the migration is
**not cutover-ready**.
