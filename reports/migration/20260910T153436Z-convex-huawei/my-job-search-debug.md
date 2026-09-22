# "My Job Search" — diagnosis and fix

2026-09-10 · reported symptom: _"stops after Start Search"_

---

## Summary: there are TWO independent faults, not one

| #     | Fault                                                                                                                                           | Status                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **A** | **The Supabase project backing this feature no longer exists.** `gzlwizgipclhelnoogmr.supabase.co` does not resolve on any public DNS resolver. | **BLOCKING — needs Mohammad.** One click in the Supabase dashboard. |
| **B** | **The search route needs 30–260s but runs as a Netlify function capped at ~10s.**                                                               | **FIXED in this pass**, verified.                                   |

Both produce the _same_ silent symptom, which is why one masks the other. Fixing B alone would not
have made the feature work — a retest would still have failed, and it would have looked like the
fix didn't take.

---

## Fault A — the database is gone

```
gzlwizgipclhelnoogmr.supabase.co   DOES NOT RESOLVE   <- JobPilot personal-search
qsjxxswsrykrrrnrpdaz.supabase.co   104.18.38.10       <- JobLabScraperAPI (the other project)
```

Checked against **both** `1.1.1.1` and `8.8.8.8`, and directly via `socket.gethostbyname`, which is
what Node/undici uses. `supabase.com` itself resolves normally, and the _other_ Supabase project in
the same account resolves fine — so this is neither a network fault nor an account-wide outage.
**That specific project is paused or deleted.**

Supabase pauses free-tier projects after ~7 days of inactivity, and a paused project's subdomain
stops resolving. That matches exactly.

Live error from the running server:

```
[personal-search status] [TypeError: fetch failed]
  [cause]: Error: getaddrinfo ENOTFOUND gzlwizgipclhelnoogmr.supabase.co
```

**Why this alone breaks the feature.** Everything the search produces lives in that project —
`search_profiles`, `search_runs`, and the job results. The AWS Lambda writes results there; the app
reads them back from there. With it gone: `upsertSearchProfile` fails, the Lambda has nowhere to
write, and the old code's Supabase-polling fallback fails on every attempt, then closes the stream
without an error. **Silent stop.**

**Fix:** open the Supabase dashboard, find project `gzlwizgipclhelnoogmr`, and restore it. If it was
_deleted_ rather than paused, the schema can be recreated from
`D:\AWS2\SupaBaseProject\JobLabScraperAPI\setup_supabase_tables.py`, but the historical search data
is gone. Note the registry recorded this project's liveness as **"not tested"** on 2026-09-07.

---

## Fault B — a Vercel-shaped route on a Netlify host

### Root cause

| Evidence              | Finding                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Netlify plan          | **`Starter`** (`nf_team_dev`) → synchronous functions terminated at **~10 s**                                                                                                              |
| `netlify.toml`        | **absent** — no timeout configuration at all                                                                                                                                               |
| The route's config    | `export const config = { maxDuration: 300 }` — a **Vercel** directive. Netlify ignores it.                                                                                                 |
| What the route needed | **30–260 s**: it deliberately waits out API Gateway's 30 s hard timeout, then polls Supabase for up to 260 s (`maxPollSeconds = 260`, commented _"stay within Vercel's 300s maxDuration"_) |

The app was built for Vercel and later moved to Netlify. `vercel.json` is still in the repo,
unused — Netlify builds with its own settings (`bun run build`, publish `build`). This route did not
survive that move.

### Why it failed _silently_

```js
while (true) {
  const { done, value } = await reader.read();
  if (done) break;      // Netlify kills the function -> stream ends cleanly
  ...
}
```

Termination closes the response stream **normally**. `done` becomes `true`, the loop breaks, no
exception is thrown, so the `catch` never runs and no error is shown. `searching` resets in
`finally` and `searchResult` was never assigned. Progress steps appear, then nothing — precisely the
reported symptom.

### Confirmed NOT the cause

The AWS search backend is healthy: `/health` → 200, `/docs` → 200, `/search` → 405 for GET
(correct for a POST-only route). Its OpenAPI spec advertises `POST /search`, `POST /search/stream`
and `GET /search/{run_id}`.

**This is why moving the AWS service to the Ubuntu box would not have fixed anything** — the fault
was never in AWS.

---

## The fix (Option 1: client-side polling)

The search backend already writes progress and results to Supabase independently of the caller —
the property the old code relied on when API Gateway 504'd. So the browser can poll instead of a
serverless function holding a connection open.

| File                                                  | Change                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/personal-jobs/auth.ts`                | **new** — `extractAuthUser` lifted out of the route so the new endpoint reuses it rather than duplicating it                                                                                                                                 |
| `src/routes/api/personal-search/status/+server.ts`    | **new** — `GET`, one indexed Supabase read. Returns run status/totals/summary and a `finished` flag. Enforces ownership when `?run_id=` is supplied                                                                                          |
| `src/routes/api/personal-search/summarize/+server.ts` | **new** — `POST`, generates the LLM summary once after completion (this used to happen inside the stream). Falls back to a deterministic summary if the LLM is unavailable, so a run is never left blank                                     |
| `src/routes/api/personal-search/+server.ts`           | added `async: true` start mode — dispatches the search and returns immediately. The LLM standardization is capped at 4 s on this path so it cannot eat the budget; the dispatch aborts its _wait_ after 4 s, which does not stop the backend |
| `src/routes/[[lang]]/app/my-job-search/+page.svelte`  | replaced SSE consumption with polling; added `pushStep` and `pollForRun`; removed the now-dead `handleSSEEvent`                                                                                                                              |

**Stale-result guard.** The client records which run was latest _before_ starting, and ignores that
run while polling. Without this, polling "latest" could instantly return the _previous_ completed
search and show stale results as if they were new.

**Backwards compatible.** The SSE and non-streaming paths on the server are untouched; only the
client stopped using them.

### Verification

| Check                    | Result                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type check               | **19 errors / 3 files — identical to the pre-change baseline.** Zero new errors (two were introduced and fixed properly by widening the `SearchResult` type, not by casting) |
| Lint (changed files)     | **0 errors**; 5 warnings, all pre-existing                                                                                                                                   |
| Production build         | **passes**                                                                                                                                                                   |
| **Start call duration**  | **2,981 ms** — against a 10,000 ms platform limit. This is the whole bug.                                                                                                    |
| Status poll duration     | **26 ms**                                                                                                                                                                    |
| New regression test      | `e2e/_migration-jobsearch.spec.ts` — **3/3 pass**                                                                                                                            |
| Existing migration suite | **8/8 pass** — no regressions                                                                                                                                                |

The regression test asserts the start call stays under 8 s, so if anyone reintroduces slow work on
that path it fails loudly instead of silently timing out in production.

### What could not be verified, and why

**An end-to-end search was not observed completing**, because Fault A means there is no database to
write results to. The test is explicitly written to report the Supabase outage rather than let it
masquerade as a pass or a failure:

```
!! status endpoint 502 - Supabase project unreachable (separate defect)
   start call: http=200 elapsed=2981ms body.status=started
```

Once the Supabase project is restored, re-run
`CI=1 bunx playwright test --config playwright.migration.config.ts e2e/_migration-jobsearch.spec.ts`
and the polling path will exercise a real run end to end.

---

## Incidental confirmation

The server log showed the isolated Convex deployment rejecting the neutralised billing key:

```
[Autumn] Invalid secret key: am_sk_test_ISOL****************************
```

That is independent live evidence that the AC-8 side-effect neutralisation is real — the isolated
backend genuinely cannot perform a billable action.

---

## What Mohammad needs to do

1. **Restore the Supabase project `gzlwizgipclhelnoogmr`** — the blocking item.
2. Re-run the regression test above to confirm end to end.
3. Optional, recommended: add a `netlify.toml` documenting the function timeout, and delete the
   stale `vercel.json` so the next person is not misled about the hosting platform (finding F-13).
