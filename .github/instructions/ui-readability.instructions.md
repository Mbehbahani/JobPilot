---
applyTo: 'src/**/*.{svelte,ts,js}'
---

# Copilot review instructions for UI and route changes

When reviewing UI and route code, focus on:

- readability of data flow and state transitions
- preserving server/client boundaries in SvelteKit
- avoiding nested conditionals and hard-to-follow rendering branches
- preventing regressions in Kanban, personal search, Gmail, and support workflows
- maintaining existing naming, routing, and file-organization conventions

Prefer suggestions that improve clarity without introducing unnecessary abstractions.
