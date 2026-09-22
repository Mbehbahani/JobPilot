# Independent evaluator verdict — MIG-002 and MIG-003

Acceptance revision **1** · evaluated 2026-09-10 · distinct native subagent context

**Independence disclosure.** A native subagent with a fresh context window inside the same host
session. Independence is **supervised, not cryptographically attested** — the Harness records
`reviewer_attestation: unsupported`. It did not generate the work under review and did not accept
the generator's self-assessment. It re-ran and re-derived rather than trusting recorded values.

## Verdicts

| Slice                                         | Verdict  |
| --------------------------------------------- | -------- |
| **MIG-002** — destination and recovery design | **PASS** |
| **MIG-003** — backup and isolated restore     | **PASS** |

**Blocking findings: none.** No required criterion returned `unknown`.

## Per-criterion

| ID                                                                         | Verdict                            | Evidence the evaluator observed itself                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC-1** backend runs, pinned image, restarts unless stopped               | **PASS**                           | `convex-huawei-backend Up (healthy)`, `0.0.0.0:3210-3211`. `RepoDigests` → `sha256:71acf855…4f1034`, **exactly** the compose pin. `RestartPolicy.Name=unless-stopped`. `curl localhost:3210/version` → 200. `systemctl is-enabled docker` → `enabled`.                                                                                                                                                                                                               |
| **AC-2** dedicated Postgres, isolated network + named volume, DB `railway` | **PASS**                           | `NetworkSettings.Ports` → `{"5432/tcp":null}` — **no host publication**. Networks: `convex-huawei-net` only; members exactly the three convex containers (no `oploy-test-*`, no Portainer). Mount → named volume `convex-huawei-pgdata`. `select datname from pg_database` → `postgres, railway, template0, template1`. Convex persistence layout present (`documents, indexes, leases, persistence_globals, read_only`); **7,168 rows in `documents`, 6,614 live**. |
| **AC-3** table set equal, component-for-component                          | **PASS**                           | Re-ran the comparison: 89 tables, 0 missing, 0 extra. Independently diffed the raw ZIP namelists: **155 entries each, set difference ∅**. Destination Postgres holds **121 distinct `table_id`s**.                                                                                                                                                                                                                                                                   |
| **AC-4** row counts match                                                  | **PASS**                           | `TOTALS 3114 / 3114`, 0 mismatches. Went further: SHA-256 of **all 155 raw ZIP entries** → **0 byte-differences**, source↔destination and source↔fresh-restore.                                                                                                                                                                                                                                                                                                      |
| **AC-5** Better Auth users/sessions restored                               | **PASS**                           | `user 17→17`, `session 71→71`, `account 19→19`, `jwks 1→1`, `passkey 1→1`, `verification 0→0`, `_tables 6→6` — all ids+content identical, byte-identical at raw-entry level. No record content read or printed.                                                                                                                                                                                                                                                      |
| **AC-13** no source write from the destination                             | **PASS**, with a stated limitation | `grep -c rlwy ~/convex-huawei/.env` → **0**; same inside the backend container. `pg_stat_activity` on the destination DB shows exactly one client, `172.19.0.4` — the backend's own address on `convex-huawei-net`. `ss -tn state established` → **0** connections to `66.33.22.228` (kodama) and **0** to `:21648`. No `psql`/`pg_dump` on the operator machine.                                                                                                    |

### Checksums independently confirmed

`convex-snapshot.zip` `bf6755977d2145bf…`, `huawei-verify.zip` `3f7c4e8e1ff49846…`,
`restore-test-verify.zip` `a018a419afcc562b…` — all match the recorded values, and file mtimes
align with the reported timeline to the second. The server's `docker-compose.yml` is
**byte-identical** to the repo copy (`02dd3947a0d3bc85…`).

### Provenance check the evaluator added on its own initiative

Byte-identity across three archives is suspiciously perfect, so it checked whether they were
simply copies. They are not: whole-file hashes differ and the ZIP central-directory **entry order
differs** between all three (Convex zeroes entry timestamps, so order is the only tell) — a file
copy would preserve order. Combined with the live destination Postgres holding 121 tables and
6,614 live documents, it is satisfied the verification exports are genuine.

## What the generator overstated — all now corrected in the reports

| #   | Overclaim                                                                                | Correction applied                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | "Reproducible configuration **lives in the repo**"                                       | `git ls-files infra/huawei-convex` → **0 files**; it is untracked. MIG-002 §3 now says so, and notes this repeats the exact defect MIG-001 criticised in the AWS runbook. Not committed — that is Mohammad's call. |
| 2   | Architecture presented as _the_ forcing constraint for logical export/import             | Access was decisive: neither source PGDATA nor `/convex/data` was ever reachable. MIG-002 §2, MIG-003 §1 and D-02 reordered.                                                                                       |
| 3   | "A physical copy across platforms is unsupported by PostgreSQL", stated as impossibility | Softened to _unsupported, not impossible_ — both platforms are little-endian LP64.                                                                                                                                 |
| 4   | D-02 omitted `pg_dump`/`pg_restore` via Railway's public proxy                           | Added as a real, reachable alternative that was not taken.                                                                                                                                                         |
| 5   | "Finding F-05 is not reproduced"                                                         | Digest pinning fixes reproducibility; `/version` still returns literally `unknown` on the destination, same as source. Now stated.                                                                                 |
| 6   | Digest table labelled "Arch: amd64"                                                      | The pins are **OCI image indexes** (multi-arch); amd64 is the locally-resolved platform. Relabelled.                                                                                                               |
| 7   | MIG-003 §4 fidelity method described as stronger than it is                              | The script can pass vacuously on empty input, silently drops unparseable lines, and ignores 66 of 155 entries. All three now documented, along with the evaluator's stricter re-verification.                      |

> "Nothing I found was fabricated. Every number, hash, timestamp and container fact in MIG-002 and
> MIG-003 that I could check reproduced exactly."

## Non-blocking findings

1. `infra/huawei-convex/` is untracked in Git (see overclaim 1).
2. **AC-1's "container up after reboot" half was never observed.** The host has not rebooted since
   deployment (`uptime -s` → 12:33:33; containers started 16:25:10, `RestartCount=0`).
   `docker.service` is enabled so boot-start is very likely, but it is **inferred from
   configuration, not observed**. If that sub-check is treated as required, it is **UNKNOWN**.
3. A stray `~/convex-huawei/.env.restore-test` credential file remained after teardown.
   **Removed** — the directory now holds only `docker-compose.yml`,
   `docker-compose.restore-test.yml` and `.env`.
4. The dashboard is published on `0.0.0.0:6791` while permanently returning 500 — a broken
   LAN-reachable listener with no current purpose. Consider not publishing it until upstream is
   fixed.
5. AC-13 rests on current-state evidence (no configured path, no live connection, no client
   tooling), which is what the criterion binds. It cannot retroactively prove no write reached the
   source at an earlier moment; closing that fully would require touching production, which the
   evaluator deliberately did not do.
6. Out of scope but observed: `.env` and `.env.convex.local` in the repo carry a plaintext
   third-party database connection string with an embedded password. Not migration-caused; belongs
   on the follow-up list beside F-09.

## Evaluator's own honest-assessment answers

- **File storage genuinely empty?** _Verified true_ from the archive: 12 `_storage/documents.jsonl`
  entries, **all 0 bytes**, no blob entries anywhere; export was taken with
  `--include-file-storage`, so blobs would have appeared had any existed.
- **Dashboard 500 an upstream defect?** _Agreed._ The require stack is entirely inside the image's
  own build output; the service's only configuration input is `NEXT_PUBLIC_DEPLOYMENT_URL`, and no
  value of that can remove a bundled module from the image. It confirmed the three additional
  images were genuinely pulled onto the host, but did not restart them to re-observe the 500.
- **Multi-arch claim correct?** _Yes_ — both pins are `application/vnd.oci.image.index.v1+json`.
