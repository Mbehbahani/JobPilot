---
applyTo: 'src/**/*.{ts,js},convex/**/*.{ts,js}'
---

# Copilot review instructions for application logic

When reviewing changes in these files, prioritize:

- authentication and user-scoped access correctness
- secret, token, and environment-variable handling
- mutation/query/action consistency across Convex logic
- failure handling, retries, stuck-state recovery, and cleanup flows
- avoiding accidental client exposure of server-only logic

Flag changes that:

- weaken validation or auth checks
- introduce untyped or loosely structured payloads where existing code is typed
- duplicate business logic that should stay centralized
- increase coupling between SvelteKit UI concerns and backend orchestration concerns

Prefer suggestions that keep diffs small and operationally safe.
