# GitHub Copilot instructions for JobPilot

## Project context

JobPilot is a production-oriented, AI-powered job search and application orchestration platform.

This repository (`JobPilot`) is the main SvelteKit application layer. It integrates with:

- **Convex** for reactive backend state, auth-linked workflows, and orchestration
- **Supabase/Postgres** for personal search persistence
- a separate **FastAPI** backend (`job-personal-search`) for scraping, normalization, and scoring

## Engineering expectations

When suggesting or generating changes, prefer:

- small, reviewable diffs
- explicit handling of failure states
- typed data flows over ad hoc object shapes
- server/client boundary awareness in SvelteKit
- heuristic-first logic before adding new LLM dependency or prompt complexity
- solutions that preserve existing deployment and env-var patterns

## Architecture guardrails

### Frontend / SvelteKit

- Keep route logic consistent with the existing `src/routes` structure.
- Avoid moving server-only logic into client components.
- Respect localized routing under `src/routes/[[lang]]`.

### Convex

- Keep schema, query, mutation, and action logic aligned.
- Prefer updating existing Convex modules over duplicating logic.
- Be careful with auth-linked state and user-scoped data access.

### Personal search subsystem

- The scraping and ranking backend lives outside this repository.
- UI/API changes in `JobPilot` should not assume scraping logic lives in the SvelteKit app.
- Preserve the separation between:
  - SvelteKit proxy/API routes
  - FastAPI search orchestration
  - Supabase persistence

## AI / LLM guidance

- Do not introduce naive prompt-only logic where deterministic logic is more reliable.
- Prefer selective enrichment over sending all records through an LLM.
- Keep outputs structured and usable by the rest of the application.
- Treat evaluation and measurability as first-class concerns.

## Code review priorities

Pay extra attention to:

- auth and token handling
- Gmail integration behavior
- task-agent cleanup / retry / stuck-state logic
- environment-variable usage
- accidental exposure of secrets or internal URLs
- regressions in user-facing workflows such as Kanban, personal search, and support flows

## Style preferences

- Be concise and practical in code comments.
- Avoid unnecessary abstractions unless they reduce real duplication.
- Match existing naming and file organization patterns.
- Prefer edits that improve maintainability and operational clarity.
