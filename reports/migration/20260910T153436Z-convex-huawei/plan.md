# Plan

Run `20260910T153436Z-convex-huawei`

## Goal

Convex compute, its database, and its persistent storage run on the Huawei Ubuntu server, with
JobPilot no longer depending on the Railway/AWS Convex infrastructure. The frontend stays where it
is. Unrelated AWS-backed features and third-party integrations are untouched.

## Dependency-ordered slices

```
MIG-001 Inventory and baseline
   |
   +--> MIG-002 Destination and recovery design      (needs verified source topology + architecture)
   |        |
   |        +--> MIG-003 Backup and isolated restore (needs a running destination)
   |                 |
   |                 +--> MIG-004 Application integration and verification
   |                          |
   |                          +--> MIG-005 Reviewed production cutover   [BLOCKED]
   |                                   |
   |                                   +--> MIG-006 Handover             [PARTIAL]
   |
   +--> (parallel) Harness task/check/review smoke cycle
```

## Slice definitions

| Slice   | Scope                                                                             | Local / remote                                       | Authorization                    | Registered check                                 | Retry bound |
| ------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------- | ------------------------------------------------ | ----------- |
| MIG-001 | Verify live topology, versions, storage, URLs, behaviour; fix acceptance criteria | local reads + read-only remote probes                | discovery                        | probe comparison vs recorded claims              | 3           |
| MIG-002 | Build the destination stack on Huawei                                             | local repo writes + remote Docker                    | isolated deployment on Huawei    | container health + digest pinning                | 3           |
| MIG-003 | Backup, restore, validate, and restore again into fresh volumes                   | read-only against source; writes to destination only | backups, protected data transfer | `compare_snapshots.py` table-by-table equality   | 3           |
| MIG-004 | Point an isolated app config at Huawei and verify behaviour                       | local build/test; remote reads                       | migration testing                | Playwright suites + build + typecheck + unit     | 3           |
| MIG-005 | Production cutover                                                                | remote, production-affecting                         | **NOT GIVEN**                    | post-cutover snapshot comparison + browser smoke | n/a         |
| MIG-006 | Handover                                                                          | documentation                                        | n/a                              | n/a                                              | n/a         |

Acceptance criteria AC-1 … AC-14 are fixed in `slices/MIG-001-inventory-and-baseline.md` §7,
acceptance revision **1**, and were written **before** implementation. They were not weakened
afterwards.

## Authorization references

All work traces to Mohammad's 2026-09-10 instruction, which authorized: _"discovery, scoped
JobPilot implementation, migration configuration, backups, protected data transfer, isolated
deployment on Huawei, and migration testing."_

Explicitly **not** authorized, and therefore not done:

- Interrupting production or changing public routing (needs prior approval with tested destination,
  cutover/rollback procedure, expected downtime and remaining findings — supplied in
  `cutover-and-rollback.md`).
- Deleting any old service, volume, snapshot, database or cloud resource.
- Sending real emails, messages, applications or billable actions.
- Editing the Vault.
- Modifying Harness core implementation to bypass a gate.

## Evidence bindings

| Binding                            | Value                                                              |
| ---------------------------------- | ------------------------------------------------------------------ |
| Run ID                             | `20260910T153436Z-convex-huawei`                                   |
| Harness session (smoke)            | `ses_8a6204c7375b4c008f49d0a98e057de6`                             |
| Harness task (smoke)               | `MIG-SMOKE-002`, contract hash `fafb922990b9de5f…`                 |
| Harness attempt                    | `attempt_92b6f9d42f89411084f94bd9e775fdf5`                         |
| Harness grant                      | `grant_834a0e50aad74e11a89a182716d8c396`                           |
| Acceptance revision                | `1`                                                                |
| Generator context snapshot         | `ctx_b972ee995499434d9bf8e01482be8260`                             |
| Review context snapshot            | `ctx_15780304314f40c8aa9d9056a0ee00cb`                             |
| Registered artifact hash           | `cb03aa33bc93e836d46b19a14f16c8b512ce991aec5b7095f64e20e4680956d6` |
| Registered check                   | `rollback-targets-v1`, policy hash `f41511f761f65312…`             |
| MCP context snapshot (cited query) | `ctx_60359d17907340ccbbf154b524b1ef0c`                             |
| Source backup                      | SHA-256 `bf6755977d2145bf…`                                        |
