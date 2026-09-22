# Harness task/check/review cycle — evidence and evaluator handoff

Run `20260910T153436Z-convex-huawei`

This slice exists to demonstrate that the Harness control plane actually works end to end during
this migration — not to assert it from its documentation.

## 1. Harness health and real tool availability

| Surface                                          | Result                                                                                                                                    | Evidence                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `doctor`                                         | `{"status":"ok","python":"3.13.14","sqlite":"3.50.4","schema_version":2,"mode":"offline","fts5":true}`                                    | CLI                                           |
| `host-status`                                    | `claude` present, version `2.1.221 (Claude Code)`; `live_mcp: pending`; `reviewer_attestation: unsupported`; `exact_token_usage: unknown` | CLI                                           |
| MCP server over stdio                            | **launches and speaks MCP** — `Personal Harness 1.29.1`, **21 tools**                                                                     | real stdio session                            |
| MCP tools inside _this_ Claude Code conversation | **NOT available**                                                                                                                         | they are absent from this session's tool list |

**The honest position on MCP.** `D:\AWS2\JobPilot\.mcp.json` now declares `personal_harness`
(merged additively — `svelte`, `convex`, `unipile`, `playwright` untouched; a
`.mcp.json.bak-premigration` copy was kept and the resulting `git diff` is additive only). Claude
Code loads MCP servers **at session start**, so the entry cannot take effect in the session that
wrote it.

This is **not** claimed to work from the configuration file. It was verified by opening a real MCP
client session over stdio against the same command the config declares, and exercising actual
tools. That is direct evidence the server works; it is _not_ evidence that this conversation can
call it, and that distinction is kept throughout.

### Exact resume instruction

> Restart Claude Code in `D:\AWS2\JobPilot`, approve the `personal_harness` MCP server when
> prompted, then confirm with `/mcp` that it reads **connected**. The tools then appear natively
> and the CLI fallback used in this run is no longer necessary.

Until then, the documented CLI is used for everything CLI-capable, and the stdio MCP client for
the tools the CLI does not expose (`review_submit`, `task_finalize`). This limitation is recorded
rather than worked around.

## 2. A real cited MCP query

Performed against a **synthetic** source root in the OS temp scratchpad. No Account Center file,
no credential file and no production backup was indexed into Harness context.

```
SERVER: {"name": "Personal Harness", "version": "1.29.1"}

1. knowledge_search(query="Postgres destination", project="migration-smoke-shared")
   results   : 1
   path      : …\harness-fixture\shared\migration-runbook.md
   heading   : Restore procedure
   source_id : src_b9dc4746f0034ef08893257ce9213adf
   hash      : 22aaf9b784d79a281557296b6d64e62a…
   trust     : source_data_not_instructions

2. source_read(source_id=…)
   hash matches search: True

3. project_context(project="migration-smoke-shared")
   context_snapshot_id: ctx_60359d17907340ccbbf154b524b1ef0c
   citations: 5
```

A first attempt returned 0 results and would have been an easy false negative to report as "MCP
retrieval is broken". The cause was mine: the server wraps payloads as `{"ok": true, "result": …}`
and my client read the top level. Recorded as P-10.

Two roots were registered: `migration-smoke` as `--sharing private-only` (correctly invisible to
client results) and `migration-smoke-shared` as `client-visible`. Both point only at synthetic
fixture notes.

## 3. Scoped synthetic task / check / review cycle

Deliberately a red-to-green cycle: the fixture **failed** its check before implementation.

| Step                                       | Command                                                   | Result                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Baseline                                   | run the checker on the untouched fixture                  | `FAIL: expected at least 2 rollback targets, got 0`, **exit 1**                                                  |
| Propose                                    | `task propose --file task.json`                           | `MIG-SMOKE-002`, contract hash `fafb922990b9de5f…`                                                               |
| Register check                             | `checks --file check.json`                                | `rollback-targets-v1`, argv+interpreter hashes pinned, policy hash `f41511f761f65312…`                           |
| Authorize (**CLI only — absent from MCP**) | `task authorize --task MIG-SMOKE-002 --authority-ref '…'` | `grant_834a0e50aad74e11a89a182716d8c396`                                                                         |
| Begin                                      | `run --task MIG-SMOKE-002`                                | `attempt_92b6f9d42f89411084f94bd9e775fdf5`, baseline hashes captured, `usage: {tokens: unknown, cost: unknown}`  |
| Generate                                   | edit `rollback_plan.py` only                              | —                                                                                                                |
| Register artifact                          | `run artifacts <attempt> rollback_plan.py`                | artifact hash `cb03aa33bc93e836…`; `trusted_checker.py` hash **unchanged**                                       |
| Verify                                     | `run verify <attempt>`                                    | `rollback-targets-v1` → **pass**, exit 0, 0.071 s, evidence hash `d2c680a5be84fecb…`                             |
| Review context                             | `run review-context <attempt>`                            | `ctx_15780304314f40c8aa9d9056a0ee00cb`                                                                           |
| **Independent evaluation**                 | distinct native subagent context                          | see §4                                                                                                           |
| Submit review                              | MCP `review_submit`                                       | `review_52c9938e6fdf4bc6a4797ab7ee9fe5cd`, `mode: supervised`, `independence: unverified`, `acknowledged: false` |
| Finalize                                   | MCP `task_finalize`                                       | **`state: blocked`** — see §5                                                                                    |

Two guardrails fired for real and are worth recording:

- The **first** `task propose` was rejected with 17 validation errors, and `task authorize` then
  refused absolute paths (`scope_denied: Expected a relative path without traversal or streams`).
  `schemas/task-contract.md` documents a different shape from the runtime `TaskContract` model.
- The **first** `review_submit` was **rejected**: `review_context: "Use the distinct recorded
evaluator context"`. The controller refused a review that did not bind the recorded evaluator
  snapshot. Fixed by binding the evaluator's own snapshot and using the runtime field names
  (`context_snapshot_id`, `gate_results`, `check_id`, `explanation`) — not by weakening the gate.

## 4. Independent evaluator verdict (distinct context)

The evaluator ran in a separate native subagent context with a fresh context window, the same
acceptance revision, and no access to the generator's self-assessment. It **re-ran the check
itself and recomputed every hash from scratch** rather than trusting recorded values.

| Criterion  | Kind          | Verdict  | Basis                                                                                                                                                                                                                                                               |
| ---------- | ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-SMOKE-1 | deterministic | **PASS** | Re-ran the registered check with the pinned argv from the registered cwd: `PASS: 3 rollback targets validated`, exit 0. Recomputed the interpreter hash and `trusted_checker.py` hash; both match the pinned `trusted_hashes`. Recorded evidence-file hash matches. |
| AC-SMOKE-2 | semantic      | **PASS** | Judged the artifact content directly. All three targets name a distinct topology layer (routing / compute / data) and an unambiguous operation.                                                                                                                     |

Independently recomputed and confirmed by the evaluator:

- `rollback_plan.py` → `ec8d92baa7b68d86744bee1a39826eb089ff1ba189f1dde86f8712f4117fb00f`
- bundle hash → `cb03aa33bc93e836d46b19a14f16c8b512ce991aec5b7095f64e20e4680956d6` (matches registration)
- contract hash re-derived → `fafb922990b9de5fd7b18f72378db616356fa55b21c429f0291a96fc5e69bad2`
- `trusted_checker.py` → `a484b5773761cb2e01aa45f9f975d8f590d4b35a8e1bcdf7ee2ec7bfdc447e47`, **identical to the attempt baseline** — the generator did not tamper with the trusted check
- Scope respected: the only changed path was `rollback_plan.py`, which is the sole entry in `allowed_paths`

**Blocking findings: none.** Non-blocking: the rollback targets declare no ordering; one target is
a preserve directive rather than an executed step; the attempt's `host` record still reads
`native_subagents: unknown` though the review did run in a native subagent.

**The evaluator's own independence disclosure**, recorded verbatim in substance: it is a native
subagent inside the same host session; its independence is **supervised, not cryptographically
attested**; the attempt's `reviewer_attestation` is `unsupported`; native agent identity is
evidence of a separate context, not of isolation. It did not generate any part of the artifact and
did not self-assess.

**Note on snapshot ids:** `run review-context` mints a new snapshot per invocation, so the
evaluator's own calls produced later snapshots. All carry the identical `artifact_hash` and
acceptance revision. The attempt's recorded `evaluator_context_snapshot_id` — and the one the
review binds — is **`ctx_9900f6ffd842426e8d30273a7f235804`**.

## 5. The cycle is BLOCKED on human acknowledgment — deliberately

```
task_finalize → {
  "state": "blocked",
  "gates": [
    {"check_id": "AC-SMOKE-1", "result": "pass",    "required": true,
     "evidence_ref": "evidence/attempt_92b6f9d4…/checkrun_1597946132…-rollback-targets-v1.txt"},
    {"check_id": "AC-SMOKE-2", "result": "unknown", "required": true, "evidence_ref": null}
  ],
  "review": "needs_human",
  "next_action": "Repair failed criteria or obtain the missing independent/human review"
}
```

The deterministic criterion passes on machine evidence. The **semantic** criterion stays `unknown`
— and therefore blocks completion — because the recorded review has `acknowledged: false`. Under
the `generator_evaluator` profile a semantic result only counts once a human acknowledges that
**exact** review and artifact hash.

**I did not, and will not, submit that acknowledgment on Mohammad's behalf.** The instruction was
explicit, and `review-ack` is deliberately absent from MCP for this reason.

If — and only if — Mohammad agrees with the evaluator's verdict above, the exact command is:

```powershell
cd D:\Harness
.\.venv\Scripts\python.exe -m personal_harness review-ack `
  --attempt attempt_92b6f9d42f89411084f94bd9e775fdf5 `
  --review review_52c9938e6fdf4bc6a4797ab7ee9fe5cd `
  --artifact-hash cb03aa33bc93e836d46b19a14f16c8b512ce991aec5b7095f64e20e4680956d6 `
  --authority-ref '<his own words acknowledging this review>'
```

This blocks only the synthetic smoke task. It does **not** block the migration work, which
continued to completion of MIG-004 as independent preparation.
