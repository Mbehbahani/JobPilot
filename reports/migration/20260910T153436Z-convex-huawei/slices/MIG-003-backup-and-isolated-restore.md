# MIG-003 — Backup and isolated restore

Status: **PASS** · awaiting independent evaluator

## 1. Backup method and why this one

The supported Convex path for moving a self-hosted deployment is a snapshot export/import, not a
filesystem copy. Reasons, in the order they actually bind:

1. **Neither source data location was reachable.** The source `PGDATA` is inside Railway's managed
   Postgres (no filesystem access at all), and `/convex/data` is on the EC2 host, which was
   unreachable after the SSH ingress change was **denied by the host permission classifier**
   (MIG-001 §9). A physical copy was never an option.
2. The architecture changes (arm64 → x86_64), so a physical `PGDATA` copy would also be
   _unsupported_ — a second, independent reason not to attempt one.
3. It is what Convex documents for moving a deployment between hosts and storage backends.

> **Correction (independent evaluator, 2026-09-10).** An earlier draft listed these in the reverse
> order, presenting architecture as the forcing constraint and access as a "bonus". Access was
> decisive. The earlier draft also omitted a genuine alternative: `pg_dump`/`pg_restore` against
> Railway's public TCP proxy was reachable and architecture-safe. `convex export` remains the
> better choice (component-aware, carries file storage, rebuilds indexes, no Postgres client
> needed), but it was not the only one.

```
2026-09-10T15:40:43Z  convex export --include-file-storage --path <backup>/convex-snapshot.zip
2026-09-10T15:40:53Z  ✔ snapshot export at timestamp 1789054845273441381
```

Run **read-only against the live AWS production backend**. Nothing was written to production.

## 2. Backup artefacts — held outside Git and outside `reports/`

Location: `C:\Backups\jobpilot-convex\20260910T153436Z-convex-huawei\`

| File                                                            | Bytes     | SHA-256                                                            |
| --------------------------------------------------------------- | --------- | ------------------------------------------------------------------ |
| `convex-snapshot.zip` (the backup)                              | 3,496,721 | `bf6755977d2145bfe31d78818f7978c1da83e62cbb6c567240c843ff6e575c16` |
| `huawei-verify.zip` (re-export from destination)                | 3,496,721 | `3f7c4e8e1ff49846c60e48c6d45f0d133517feb19ce48ee41087ffc3bf46da2c` |
| `restore-test-verify.zip` (re-export from fresh-volume restore) | 3,496,721 | `a018a419afcc562bc979e540b87a2b73702c5c702e4b78c26ab919c6e2e1215d` |

The three archives differ in SHA-256 because ZIP metadata (timestamps, entry order) differs; their
**contents are provably identical** — see §4. Checksums are mirrored into
`evidence/backup-SHA256SUMS.txt`. No record content appears in any report.

## 3. What the backup includes and excludes — established empirically

The documentation does not state whether component data is covered; a direct fetch of the Convex
export docs could not answer it. It was determined by reading the archive index.

**Included** (recursively, nested components too): all 15 application tables; `betterAuth`
(`user`, `session`, `account`, `jwks`, `passkey`, `verification`); `agent` (`messages`, `threads`,
`streamDeltas`, `streamingMessages`, `memories`, `files`, `apiKeys`, 11 `embeddings_*`); `resend`
(`emails`, `content`, `deliveryEvents`, `lastOptions`) plus nested `emailWorkpool`,
`callbackWorkpool`, `rateLimiter`; `autumn`; `rateLimiter`; `convexFilesControl` plus nested
`actionRetrier`; `unipile`; and `_storage` manifests at every level.

**Excluded, and how each was handled:**

| Excluded                                        | Handling                             | Verified                                                                                 |
| ----------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| Deployed function code (modules)                | `convex deploy` from repo source     | 207 functions, **identical** to source (§5)                                              |
| Deployment environment variables                | re-set explicitly on the destination | 16 non-empty of 23; 7 empty in source were skipped                                       |
| Pending `_scheduled_functions` / in-flight jobs | accepted as lost                     | the source's workpool `pendingStart`/`work` tables were **empty**, so nothing was queued |
| Search / vector index files                     | rebuilt from schema on import        | index creation logged during deploy                                                      |

**File storage is currently empty.** Every `_storage/documents.jsonl` — root and every component —
is 0 bytes, and `fileMetadata` has 0 rows. There is no stored file data to migrate today. That did
**not** excuse skipping the upload/download test; see MIG-004 test 7, which passes.

## 4. Restore into the destination, and the fidelity check

```
2026-09-10T15:52:35Z  target asserted = http://10.130.231.5:3210   (guard: refuse anything else)
                      destination confirmed EMPTY: "There are no tables in the database."
2026-09-10T15:52:40Z  convex import --replace-all --yes → ✔ Added 3049 documents
```

Verification method: re-export from the destination and compare against the source archive
**table by table**, using per-table document counts, a SHA-256 over the sorted set of document
`_id`s, and a SHA-256 over the sorted canonical JSON of every document. Aggregate only — no field
values are printed, so no personal data leaves the archive.

```
tables compared      : 89
missing in dest      : 0
extra in dest        : 0
count/id mismatches  : 0
content-only diffs   : 0
TOTALS               : 3114 source documents, 3114 destination documents
VERDICT              : PASS
```

Every one of the 89 table paths reports `OK (ids+content identical)`. Full output:
`evidence/restore-comparison.txt`.

> **Method limitations (found by the independent evaluator — the conclusion survives, the method as
> written does not prove it alone):**
>
> 1. The script would report `PASS` **vacuously** on two archives containing no `documents.jsonl`
>    at all; it never asserts non-emptiness. Only the printed `tables compared: 89` /
>    `TOTALS 3114` rules that out.
> 2. It **silently drops unparseable lines** (`except: continue`), so a systematically malformed
>    export would compare "equal" while being equally broken on both sides. The evaluator checked:
>    non-blank lines = parsed lines = **3114** in all three archives, so nothing was skipped.
> 3. It **ignores 66 of the 155 archive entries** — the 65 `generated_schema.jsonl` files and
>    `README.md` are never compared. The evaluator compared them: all 66 byte-identical.
>
> The evaluator then replaced the method with a stricter one — SHA-256 of **every one of the 155
> ZIP entries** — and found **0 differences**, source↔destination and source↔fresh-restore. It also
> confirmed the archives are not copies of one another (whole-file hashes differ and the ZIP
> central-directory entry order differs, which a file copy would preserve), and corroborated the
> restore live in the destination Postgres: **121 distinct `table_id`s, 6,614 live documents**.
>
> It also reconciled the two counts that look inconsistent in this report: `convex import` says
> **3,049 documents** while the comparison totals **3,114**. The difference is the 65 `_tables` /
> `_storage` manifest rows: 3,049 + 65 = 3,114. Not a discrepancy.

Representative counts (aggregate, no identifiers): `betterAuth/user` 17, `betterAuth/session` 71,
`betterAuth/account` 19, `betterAuth/jwks` 1, `betterAuth/passkey` 1, `agent/messages` 2183,
`agent/threads` 204, `resend/emails` 38, `resend/content` 76, `todoBoards` 8, `userSettings` 5,
`openaiConnections` 5, `gmailConnections` 4, `supportThreads` 4, `emailEvents` 20.

**Relationships and important IDs are preserved by construction and proven by the id-set hash**:
`--replace-all` retains original `_id` and `_creationTime` values, and the comparison shows the
sorted `_id` set matches exactly for every table. Foreign keys between tables (e.g. a
`todoBoards` row's `userId` referencing `betterAuth/user`) therefore still resolve — and this was
independently confirmed behaviourally: existing users sign in, and existing boards load
(MIG-004).

## 5. Functions and environment

```
2026-09-10T15:54:52Z  convex deploy -y → http://10.130.231.5:3210
2026-09-10T15:55:12Z  ✔ Deployed. Components remounted: agent, autumn, betterAuth,
                      convexFilesControl(+actionRetrier), rateLimiter,
                      resend(+callbackWorkpool, emailWorkpool, rateLimiter)
```

`convex function-spec` was captured from **both** deployments and diffed:

```
src: 207 functions
dst: 207 functions
diff: IDENTICAL function surface
```

Evidence: `evidence/function-spec-src.txt`, `evidence/function-spec-dst.txt`.

**Note (finding F-04 confirmed):** the source deployment carries a `unipile` component that
`convex.config.ts` does not declare. It was present in the backup (empty) and was restored, but
`convex deploy` did not remount it, so it is now unmounted on the destination. No data was lost —
its tables held 0 rows — but this is a real drift between the deployed source and repo source and
must be settled before cutover.

## 6. Side effects neutralised BEFORE the restored backend could act

Order mattered: data was imported into a backend with **no functions deployed** (therefore no
crons, no actions, no HTTP routes), environment variables were set, and only then were functions
deployed. So no copied job could fire while the destination was unconfigured.

| Risk                                   | Control                                                                                                                 | Evidence                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Outbound email (Resend)                | `RESEND_API_KEY` replaced with an inert placeholder                                                                     | env sync log marks it `NEUTRALISED` |
| Forged/replayed Resend webhooks        | `RESEND_WEBHOOK_SECRET` replaced                                                                                        | `NEUTRALISED`                       |
| Billing (Autumn)                       | `AUTUMN_SECRET_KEY` replaced                                                                                            | `NEUTRALISED`                       |
| Queued email work resuming             | none existed — `emailWorkpool.work`, `pendingStart`, `pendingCompletion`, `pendingCancelation` all 0 rows in the backup | ZIP index                           |
| Writes escaping to the source database | `POSTGRES_URL` asserted to target the compose `postgres` service, with an explicit `rlwy.net` check before transfer     | `.env` assertion output             |
| Commands aimed at the wrong deployment | every destructive CLI call guarded by a target assertion on `10.130.231.5` before running                               | inline in each command              |
| Nova / agent actions                   | no LLM provider key is set on the destination (`OPENROUTER_API_KEY` is not set on either deployment)                    | env name list                       |
| OAuth / Gmail / Unipile                | **not exercised** — marked _pending_, not passed                                                                        | MIG-004 §pending                    |

## 7. Restore into a completely fresh, independent destination

To prove the backup is restorable from nothing — not merely that the destination happens to hold
the right rows — a throwaway stack was built with its own compose project, network, volumes,
Postgres and ports (`3220`/`3221`).

```
2026-09-10T16:37:19Z  convex import --replace-all --yes → ✔ Added 3049 documents
2026-09-10T16:37:24Z  re-export and compare against the ORIGINAL backup
```

```
tables compared      : 89     missing: 0    extra: 0
count/id mismatches  : 0      content-only diffs: 0
TOTALS               : 3114 / 3114
VERDICT              : PASS
```

Evidence: `evidence/fresh-volume-restore-comparison.txt`.

A first attempt failed usefully and is recorded rather than hidden: Compose interpolates
`${POSTGRES_PASSWORD}` from the **project directory's `.env`**, so the throwaway Postgres was
initialised with the _main_ stack's password while its backend used the throwaway one —
`FATAL: password authentication failed for user "convex"`. Fixed by passing
`--env-file .env.restore-test` explicitly. The stack was then torn down with `down -v`; the main
stack and all unrelated services were confirmed untouched immediately afterwards.

## 8. The source was never at risk

- Only one operation ever touched the source: a **read-only** `convex export`.
- No `convex import`, `deploy`, `env set` or `run` was ever issued against
  `https://convex-cloud.oploy.eu`. Every mutating command carried a shell guard asserting the
  target contained `10.130.231.5`, and the guard was written to `exit 1` otherwise.
- The Railway Postgres was never connected to from the destination: no `psql`/`pg_dump` client is
  even installed on this machine, and the destination's `POSTGRES_URL` was asserted free of
  `rlwy.net` before it was transferred.
- The production deployment's environment variables were **read** to copy them; they were never
  modified.
