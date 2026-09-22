# Effort and usage

Run `20260910T153436Z-convex-huawei`

## Wall-clock span

| Marker                          | UTC                                       |
| ------------------------------- | ----------------------------------------- |
| First discovery probe           | 2026-09-10T15:34Z (run directory created) |
| Source backup taken             | 2026-09-10T15:40:43Z – 15:40:53Z          |
| Destination stack first healthy | 2026-09-10T15:51:51Z                      |
| Restore into destination        | 2026-09-10T15:52:35Z – 15:52:40Z          |
| Functions deployed              | 2026-09-10T15:54:52Z – 15:55:12Z          |
| Restart-recovery test           | 2026-09-10T16:25:08Z – 16:25:17Z          |
| Fresh-volume restore verified   | 2026-09-10T16:37:19Z – 16:37:24Z          |

Total elapsed span for the implementation slices: **roughly 1 h 05 m**.

## What is NOT claimed

- **Tokens: unknown.** The host does not expose token counts to this session.
- **Cost: unknown.** No cost figure is available; none is invented.
- **Active effort is not the same as elapsed time.** The span above includes image pulls,
  a 111.5 MiB Playwright browser download, `apt` installation, and repeated waiting on container
  health. That waiting is not work and is not counted as such.
- The Harness records the same honestly: the attempt record for `MIG-SMOKE-002` carries
  `"usage": {"tokens": "unknown", "cost": "unknown"}`.

## Measured operation durations (actual, from command output)

| Operation                                       | Duration   |
| ----------------------------------------------- | ---------- |
| Source snapshot export (3,049 docs, 3.5 MB)     | 10 s       |
| Import into destination                         | 5 s        |
| `convex deploy` (207 functions, all components) | 20 s       |
| Production build (`vite build --mode huawei`)   | 1 m 08 s   |
| Unit tests (193 tests)                          | 22.8 s     |
| Type check (14,898 files)                       | ~2 m       |
| Project e2e suite (42 tests)                    | 2 m 18 s   |
| Migration verification suite (8 tests)          | 45 s       |
| Stack restart to healthy                        | under 10 s |
| Fresh-volume import                             | 5 s        |
| Trusted check `rollback-targets-v1`             | 0.071 s    |

## Retries and repeats

| Activity                    | Attempts        | Why repeated                                          |
| --------------------------- | --------------- | ----------------------------------------------------- |
| Writing `.mcp.json`         | 4               | heredoc backslash mangling (P-04)                     |
| Browser sign-in diagnosis   | 4               | cookie-prefix shim (P-06)                             |
| Restore-test stack bring-up | 2               | compose env-file interpolation (P-08)                 |
| File upload/download test   | 2               | first payload was a disallowed MIME type (P-09)       |
| MCP cited query             | 3               | response-envelope parsing (P-10)                      |
| Harness task contract       | 3               | documented schema differs from runtime model (P-11)   |
| Dashboard image             | 4 images probed | upstream defect, not resolvable (P-12)                |
| Full e2e suite              | 2               | Playwright browsers not installed on first run (P-07) |

## Blocked actions

| Action                                                           | Outcome                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| `aws ec2 authorize-security-group-ingress` (SSH for operator IP) | denied by host permission classifier; not retried, not worked around |
| Several compound SSH commands and one repo-wide `grep`           | blocked; re-issued as short, scoped commands                         |
