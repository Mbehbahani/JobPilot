# CLAUDE/AGENTS.md

This project is a saas template built with SvelteKit, Convex, Typescript and modern web technologies.

## Nova Branding

"Nova" is the user-facing name for our AI task agent. All UI text, translations, and marketing copy must use "Nova" — never "agent", "AI agent", or similar generic terms. Internal code (variable names, types, file names) can still use `agent`.

## btca

When you need up-to-date information about technologies used in this project, use btca to query source repositories directly.

**Available resources**: svelte, sveltekit, shadcnSvelte, shadcnSvelteExtras, bitsUi, runed, formsnap, superforms, paneforge, svelteInfinite, motionSvelte, svAnimate, threlte, xyflow, cnblocks, aiElements, convex, convexSvelte, convexAgent, convexHelpers, convexResend, convexPresence, convexRag, convexStripe, convexRateLimiter, convexActionCache, convexFilesControl, convexTimeline, convexMigrations, convexAggregate, convexShardedCounter, convexGeospatial, convexWorkpool, convexWorkflow, convexRetrier, convexCrons, betterAuth, betterSvelteEmail, tailwind, vercelAi, tanstackTable, tolgee, playwright, vitest, valibot, nprogress, renovate, justBash, webHaptics

### Usage

```bash
btca ask -r <resource> -q "<question>"
```

Use multiple `-r` flags to query multiple resources at once:

```bash
btca ask -r svelte -r convex -q "How do I integrate Convex with SvelteKit?"
```

**Branch config:** When adding a new resource, verify the repo's default branch (`gh api repos/OWNER/REPO --jq '.default_branch'`). btca assumes `main` and fails silently on repos using `master`, `dev`, etc. Always set the `branch` field explicitly.

## Development Commands

### Core Development

- `bun run generate` - To generate the code in the `convex/_generated` directory that includes types required for a TypeScript typecheck. Run this command whenever you make changes to the convex schema.
- `bun run build` - Build for production

NEVER use `bun run dev` to start the development server, its already running in a separate terminal.

### Quality Checks & Testing

- `bun run check` - Run Svelte type checking. Run this between implementations to catch type errors early.
- `bun run test` - Run all tests (E2E + unit)
- `bun run test:e2e` - Run Playwright E2E tests. Always run this after modifying E2E tests!
- `bun run test:unit` - Run Vitest unit tests
- `bun run format` - Format code with Prettier

### Convex Backend

- `bun convex run tests:init` - Initialize test data
- `bun convex env set KEY value` - Set Convex environment variables
- `bun convex env set KEY value --prod` - Set production environment variables

### Convex Components Storage

Convex components have isolated tables and storage namespaces. App code cannot use `ctx.storage.getUrl` to access a component's stored files. Use the component's APIs (e.g., download grants or HTTP routes) to fetch files/blobs instead.

### Convex Platform Guarantees

When reviewing Convex backend code, be aware of these platform guarantees.
See [official docs](https://docs.convex.dev/scheduling/scheduled-functions) for details.

**Scheduler Guarantees:**

- Scheduling from mutations is atomic - if `ctx.scheduler.runAfter()` is called within a mutation, it's part of the transaction. Either the whole mutation succeeds (including the schedule), or it all rolls back.
- Scheduled mutations are guaranteed exactly-once execution. Convex automatically retries internal errors, and only fails on developer errors.
- Actions are different - scheduling from actions is NOT atomic, and actions execute at-most-once (no automatic retry due to potential side effects).

**Components with Built-in Durability:**

- `@convex-dev/resend`: Idempotency keys guarantee exactly-once email delivery, durable execution via workpools (default: 5 retries, 30s initial backoff). Catching errors from `resend.sendEmail()` is valid - they indicate permanent failures (invalid config), not transient network issues. See [component docs](https://www.convex.dev/components/resend).
- `@convex-dev/workpool`: Configurable retry with backoff/jitter, `onComplete` callbacks, parallelism control.

Note: Other components (`@convex-dev/better-auth`, `@convex-dev/rate-limiter`, `@convex-dev/agent`) do NOT have automatic retry for external API calls - standard error handling applies.

### Tolgee CLI

These commands use `dotenv` to load the local TOLGEE_API_KEY from `.env.local`:

- `bun run i18n:pull` - Download latest translations from Tolgee Cloud. Run this ALWAYS before making any changes to the `src/i18n/*` json translation files.
- When adding new translation keys, ALWAYS add translations for ALL languages in the `src/i18n/*` json translation files.
- `bun run i18n:push` - Upload local translations. ALWAYS run this after making any changes to the `src/i18n/*` json translation files. Otherwise, your changes wont be pushed to the cloud! Run with `-- --tag-new-keys draft` to tag new keys as e.g. 'draft'

  Use tags to organize translation keys:
  - `draft` - New keys awaiting review
  - `feature-*` - Keys for specific features (e.g., `feature-auth`, `feature-checkout`)
  - `v*.*.*` - Keys added in specific versions (e.g., `v1.5.0`)

- `bun run i18n:cleanup` - Find every key that used to be in production but is now missing from the code; mark it as deprecated and stop calling it a production key.

  Tags automatically set by the `scripts/vercel-deploy.ts` script:

- `preview` - Automatically set for preview deployment keys
- `production` - Automatically set for production deployment keys
- `deprecated` - Keys no longer in code (safe to delete after review)

## Architecture Overview

### Tech Stack

- **Frontend**: SvelteKit, Svelte 5 (runes syntax!), Tailwind CSS v4, Shadcn Svelte
- **Backend**: Convex (real-time database + serverless functions)
- **Authentication**: Better Auth Svelte Convex Component @convex-dev/better-auth-svelte. We use the local install to get full better auth feature access like passkeys, admin, etc. See <https://labs.convex.dev/better-auth/features/local-install> for authentication documentation.
- **Internationalization**: Tolgee (open source / cloud-hosted translation management with URL-based localization and in-context editing)
- **Testing**: Playwright (E2E), Vitest (unit)
- **Package Manager**: Bun. ALWAYS use bun instead of npm to run commands.

### Project Structure

- `src/lib/convex/` - Convex backend functions, schema, and auth config
- `src/lib/components/` - UI components
- `src/lib/i18n/` - Internationalization configuration
- `src/routes/[[lang]]/` - SvelteKit routes with language parameter
- `src/hooks.server.ts` - Server hooks for auth and language middleware
- `docs/references/unipile-node-sdk/` - Local copy of the Unipile Node SDK source. Consult this before implementing any Unipile integration.
- `docs/references/daytona-sdk/` - Daytona TS/Python SDK source. Consult `packages/typescript/src/` (Daytona.ts, Sandbox.ts, Process.ts, FileSystem.ts) for API types before implementing sandbox features.
- `docs/references/mistral-vibe/` - Mistral Vibe CLI source (v2.3.0). Consult `vibe/core/config.py` for config format, `vibe/core/llm/backend/` for supported backends (mistral, generic), `vibe/core/programmatic.py` for programmatic/headless mode, and `vibe/cli/entrypoint.py` for CLI args.

**Using translations in components:**

```svelte
<script lang="ts">
	import { T } from '@tolgee/svelte';
</script>

<T keyName="welcome_message" />
<T keyName="greeting" params={{ name: 'John' }} />
```

**SEO meta tags:**

```svelte
<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
</script>

<SEOHead title="About Us" description="Learn more" />
```

- Every new `+page.svelte` route must include `SEOHead`.
- For localized routes under `src/routes/[[lang]]/`, `SEOHead` title and description must use translated `meta.*` keys in all 4 locale files (`en`, `de`, `es`, `fr`).
- `meta.*.title` values must be page-title only and must NOT include the site suffix or brand name. `SEOHead` appends `| JobFlow` automatically (use `"Settings"`, not `"Settings - JobFlow"`).

### Email System

Use the @convex-dev/resend email system for production-ready email delivery. Use btca with `convexResend` resource for component docs. For svelte email docs and templates, use btca with `betterSvelteEmail` resource.

#### Email System Architecture

```text
src/lib/convex/emails/
├── resend.ts              # Resend client configuration
├── events.ts              # Webhook event handlers
├── send.ts                # Email sending mutations
├── queries.ts             # Email status queries
└── mutations.ts           # Email management (cancel, status)
```

Emails are sent via internal mutations using the Resend component.

#### Email Event Tracking

Email events are automatically stored in the `emailEvents` table:

- `email.delivered` - Successfully delivered
- `email.bounced` - Hard or soft bounce
- `email.complained` - Marked as spam
- `email.opened` - Email opened (requires tracking enabled in Resend)
- `email.clicked` - Link clicked (requires tracking enabled in Resend)

Query email events using:

```typescript
const events = await ctx.runQuery(api.emails.queries.getEmailEvents, {
	emailId: 'email-id'
});
```

### PostHog Analytics

This project uses **PostHog** for product analytics with an optional **Cloudflare Worker proxy** to bypass ad blockers while minimizing costs.

## Testing Guidelines

### E2E Playwright Tests

- Located in `e2e/` directory
- Test users are automatically created with unique emails each run (via globalSetup) and deleted after tests (via globalTeardown)
- Requires `.env.test` with: AUTH_E2E_TEST_SECRET (must match Convex backend) and PUBLIC_CONVEX_URL
- See `.env.test.example` for setup instructions

#### `data-testid` convention

- Prefer `data-testid` for all interactive controls and dynamic list/table content that E2E tests assert.
- Use stable, feature-scoped kebab-case IDs: `<feature>-<element>-<action>` (example: `admin-users-pagination-next`).
- Add test IDs on:
  - page root container
  - loading/empty states
  - filters/search/sort controls
  - pagination controls and page indicators
  - repeatable row/cell primitives needed for assertions (for example role/status badges and email cells)
- Avoid translated/user-generated strings in test IDs.
- Keep IDs deterministic and never include runtime values unless the test explicitly needs entity-specific targeting.

#### Convex table kit usage

- Use `createConvexCursorTable(...)` for table state orchestration (URL params, cursor stack, search/filter/sort/page-size resets, and next/previous prefetching).
- Use `ConvexCursorTableShell` for common chrome (search, toolbar slots, pagination controls, page indicator, rows-per-page).
- Required backend contract:
  - list query args: `cursor`, `numItems`, optional `search`, optional filters, optional `sortBy`
  - list query return: `{ items, continueCursor, isDone }`
  - count query args: same search/filter set (no cursor)
  - count query return: `number`
- Canonical URL keys for tables: `search`, `sort`, `page`, `page_size`, `cursor`, plus feature filter keys (for example `role`, `status`, `type`).
- Canonical sort serialization: `field.dir`.
- Default URL values must be omitted from links (`search=''`, `sort=''`, `page='1'`, `page_size` default, and default filter values).
- Shell testid convention:
  - search: `<prefix>-search`
  - page indicator: `<prefix>-page-indicator`
  - pagination: `<prefix>-pagination-prev` / `<prefix>-pagination-next` / `<prefix>-pagination-last` (first page button uses lg-only variant)
  - keep route-specific row/cell IDs for assertions (for example `recipient-row-*`, `admin-users-email-cell`).

### Vitest Unit Tests

## Development

<important_info>
Use Svelte 5's new syntax with TypeScript for reactivity, props, events, and content passing. Prioritize this over Svelte 4 syntax.
Key Changes:
Reactivity: $state for reactive state, $derived for computed values, $effect for side effects.
Props: Use $props() instead of export let.
Events: Use HTML attributes (e.g., onclick) instead of on:.
Content: Use {#snippet} and {@render} instead of slots.
Quick Examples:
State & Events: `<script lang="ts">let count = $state(0); </script> <button onclick={() => count += 1}>{count}</button>`
Derived: let doubled = $derived(count \* 2);
Props: <script lang="ts">let { name = 'World' } = $props(); </script> `<p>Hello, {name}!</p>`
Binding: `<script lang="ts">let { value = $bindable() } = $props(); </script> <input bind:value={value} />`
Snippets: `<div>{@render header()}</div> with <Child>{#snippet header()}<h1>Header</h1>{/snippet}</Child>`
Class Store: class Counter { count = $state(0); increment() { this.count += 1; } } export const counter = new Counter();
Notes:
Type $derived explicitly (e.g., let items: Item[] = $derived(...)) for arrays in TypeScript.
Default to new syntax for Svelte 5 benefits.
Avoid stores unless necessary for pub/sub.

Use the Svelte MCPs Get Documentation tool to get up-to-date Svelte documentation (only call this with a subagent!) and check code with the MCPs autofixer for wrong patterns. Query the svelte repo with btca for new features like remote functions.

Prop names must match the parent's passed prop name exactly.
</important_info>

### Static Checks

ALWAYS run `bun scripts/static-checks.ts src/lib/foo.ts src/routes/bar.svelte` after a full feature implementation with the changed files.

### Real-time Features

- Use Convex's `useQuery` for reactive data
- Use Convex's `useMutation` for data modifications
- Use Convex's `useAction` for server-side actions

### Library Conventions and Key Patterns

#### Import Conventions

**CRITICAL:** NEVER use Barrel Imports

```typescript
// ❌ BAD - Barrel import (loads entire library, ~4.5MB for Lucide)
import { ArrowUp, Camera, X } from '@lucide/svelte';

// ✅ GOOD - Individual imports (only loads what's needed, ~5KB per icon)
import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
```

This applies to all icon libraries and large component libraries.

#### UI Component Conventions

- Always use shadcn-svelte for ui components first. Use btca with `shadcnSvelte` resource.
- If a ui component doesn't exist in shadcn-svelte, check `@ieedan/shadcn-svelte-extras`. Use btca with `shadcnSvelteExtras` resource.
- For AI related components, check if ai-elements has what you need. Use btca with `aiElements` resource.
- Check cnblocks for well designed header, feature, pricing, footer and many more marketing blocks. Use btca with `cnblocks` resource.
- Only create a new component if it doesn't exist in any of the above libraries.
- When implementing a new component, follow the existing shadcn-svelte component api and patterns in `src/lib/components/ui/`
- Use Tailwind CSS classes for layout and styling in general. Do not add additional styling classes to the shadcn svelte components. They look good by default.
- Prefer reusable Tailwind utilities (defined globally with `@utility` in `src/routes/layout.css`) over component-local `<style>` blocks for shared styling patterns (for example `no-drag`).
- Accessibility localization rule (all UI):
  - Never hardcode human-facing `aria-label` or `.sr-only` text in English.
  - Always localize screen-reader labels via Tolgee keys (not only tables, applies to all UI controls and navigation).
  - Accessible naming convention: prefer localized `.sr-only` text for icon-only buttons, use localized `aria-label` when hidden text is not practical, and avoid redundant double-labeling.

#### Keyboard Shortcuts

Never hardcode `⌘` or `Ctrl`. Use `cmdOrCtrl` / `optionOrAlt` from `$lib/hooks/is-mac.svelte` to show the correct modifier per platform.

#### Animations

Simple animations should be implemented with plain CSS whenever possible.
Before implementing any custom animation, check if sv-animate has a prebuilt component that can be used. Use btca with `svAnimate` resource.
For custom animations, use Sveltes built in animations, or motion-svelte (Framer motion for Svelte). Use btca with `motionSvelte` resource. Before implementing any custom animation, read the `docs/animation-rules.md` file. You must follow the rules in the file when implementing your own animations!
For page transitions and state changes, use the View Transitions API. See `docs/animation-rules.md` for setup and patterns.

#### Forms

Use this decision policy before implementing any form.

**Field UI conventions (all forms):**

- `import * as Field from '$lib/components/ui/field/index.js'`
- Wrap grouped controls in `Field.Group`.
- Do not add explicit spacing/layout utility classes to `Field.Group` (for example `gap-*`, `space-y-*`, `mt-*`, `mb-*`, `px-*`, `py-*`). Keep `Field.Group` spacing implicit.
- Each control should be a `Field.Field` with label + input + optional description/error.
- Keep `Field.Error` directly under its input inside the same `Field.Field` for field-level errors.
- Form-level errors (e.g. banners) may be outside `Field.Field`.
- Prefer one primary inline error message per field.

**Remote functions decision tree:**

1. Is this a Better Auth/session-sensitive flow (`signin`, `signup`, `forgot/reset`, `changeEmail`, `changePassword`)?
   - Yes -> Use existing client-side `authClient` pattern.
   - No -> Continue.
2. Is this realtime/high-frequency/optimistic interaction (chat composers, inline table edits, streaming workflows)?
   - Yes -> Use Convex client `useMutation` / `useAction` patterns.
   - No -> Continue.
3. Is this a one-shot server mutation with clear submit lifecycle and schema validation needs?
   - Yes -> Use SvelteKit remote `form(schema, handler)` with Valibot.
   - No -> Keep local/client form handling.
4. Does it include file upload?
   - If pre-upload/presigned-upload is already part of UX, keep upload client-side and only remote-submit final metadata if needed.

**Current repo guidance:**

- Good remote-form candidates: admin/settings-style one-shot forms (e.g. add-email dialog).
- Not recommended: auth pages, account email/password settings auth mutations, community chat submit, generic UI-only/dialog wrapper forms.

For remote-form implementation workflow only, read `docs/form-instructions.md`.

#### Lists with a lot of items

---

Use `svelte-infinite` with convex-svelte pagination for huge lists to automatically load more items as the user scrolls down the list. Use btca with `svelteInfinite` and `convexSvelte` resources. Before implementing this, research this codebase to see the pattern used in the existing code.

#### Runed (collection of utilities for Svelte 5)

Before creating our own utilities, research the runed library to see if the utility you need already exists. Use btca with `runed` resource.

- For URL/query state, prefer Runed `useSearchParams` over manual `$page.url` + `goto` wiring.
- Exception: in high-frequency selection UIs where query-param writes would cause unwanted Convex refetches (for example `src/routes/[[lang]]/admin/support/+page.svelte` thread selection), manual URL handling is acceptable.
  Here is a list of the utilities available:

<resource: Watches for changes and runs asynchronous data fetching, combining reactive state management with async operations.>
<watch: Runs a callback whenever specified reactive sources change. Includes variants like watch.pre (uses $effect.pre) and watchOnce / watchOnce.pre (run only once).>
<Context: A type-safe wrapper around Svelte's Context API for sharing data between components without prop drilling.>
<Debounced: A simple wrapper over useDebounce that returns a debounced state, allowing cancellation or immediate updates.>
<FiniteStateMachine: Defines a strongly-typed finite state machine for managing states and transitions based on events. Supports actions, lifecycle methods, wildcard handlers, and debouncing.>
<PersistedState: A reactive state manager that persists and synchronizes state across browser sessions and tabs using Web Storage APIs (localStorage or sessionStorage).>
<Previous: Tracks and provides reactive access to the previous value of a getter function.>
<StateHistory: Tracks changes to a getter's value, logging them and providing undo/redo functionality.>
<activeElement: Reactively tracks and provides access to the currently focused DOM element, searching through Shadow DOM boundaries.>
<ElementRect: Reactively tracks an element's dimensions (width, height) and position (top, left, right, bottom, x, y), updating automatically.>
<ElementSize: Reactively tracks only an element's dimensions (width, height), updating automatically.>
<IsFocusWithin: Tracks whether any descendant element has focus within a specified container element.>
<IsInViewport: Tracks if an element is visible within the current viewport, using useIntersectionObserver.>
<useIntersectionObserver: Watches for intersection changes of a target element relative to an ancestor element or the viewport. Allows pausing, resuming, and stopping the observer.>
<useMutationObserver: Observes changes (like attribute modifications) in a specified DOM element. Allows stopping the observer.>
<useResizeObserver: Detects and reports changes in the size (contentRect) of an element. Allows stopping the observer.>
<useEventListener: Attaches an event listener to a target (like document or an element reference) that is automatically disposed of when the component is destroyed or the target changes.>
<IsIdle: Tracks user activity (mouse, keyboard, touch) to determine if the user is idle based on a configurable timeout. Provides the last active time.>
<onClickOutside: Detects clicks outside a specified element and executes a callback. Useful for closing modals or dropdowns. Offers controls to start/stop the listener.>
<PressedKeys: Tracks which keyboard keys are currently being pressed. Allows checking for specific keys or getting all pressed keys.>
<useGeolocation: Provides reactive access to the browser's Geolocation API, including position coordinates, timestamp, error state, and support status. Allows pausing and resuming location tracking.>
<AnimationFrames: A wrapper for requestAnimationFrame that includes FPS limiting and provides frame metrics like delta time and current FPS.>
<useDebounce: Creates a debounced version of a callback function, delaying execution until after a specified period of inactivity. Allows forcing immediate execution or cancellation.>
<IsMounted: A simple class that returns the mounted state (true or false) of the Svelte component it's instantiated in.>

#### PaneForge

Components that make it easy to create resizable panes in your Svelte apps. Use btca with `paneforge` resource.

#### Threlte

Build interactive 3D apps for the web. Use btca with `threlte` resource. <https://threlte.xyz/>

#### Svelte Flow

A customizable Svelte component for building node-based editors and interactive diagrams by the creators of React Flow. Use btca with `xyflow` resource. <https://svelteflow.dev/>

### Vercel

- `vercel` - Deploy to Vercel
- `vercel --prod` - Deploy to production
- `vercel env ls` - List environment variables
- `printf "value" | vercel env add KEY environment` - Add environment variable (using printf avoids trailing newlines added when using heredoc)
- `vercel env rm KEY environment` - Remove environment variable
- `vercel logs` - View deployment logs
- `vercel domains` - Manage custom domains

### Environment Variable Sync

Shared env vars (e.g. `UNIPILE_DSN`, `UNIPILE_API_KEY`, `SANDBOX_INTERNAL_API_KEY`) must be identical across all three targets. The sandbox runs on Vercel but uses account IDs from Convex — mismatched credentials will silently break all SDK calls.

When changing a shared env var, always update all three:

1. `bun convex env set KEY value` — Convex development
2. `bun convex env set KEY value --prod` — Convex production
3. `printf "value" | vercel env add KEY production` — Vercel production

## Task Agent Architecture

Single agent (Claude Opus via Convex Agent) that generates and executes Unipile SDK code directly:

```
Kanban task → Agent (plan + write code + execute) → results back
```

**Agent** (Convex Agent, server-side): analyzes task, writes TypeScript code using the Unipile SDK, executes it via `executeUnipileCode` tool (POST to `/api/sandbox/execute` → Node VM with SDK facade), updates Kanban status.

The agent's instructions include the full Unipile SDK reference so it knows all available methods, parameters, and patterns.

### Example: "Connect with hackathon attendees on LinkedIn"

1. Agent writes code: `unipile.email.getAll(...)` → returns emails
2. Agent extracts attendee names from email content
3. Agent writes code: `unipile.users.getProfile(...)` → returns profiles
4. Agent writes code: connect requests → sends them
5. Agent: "Connected 47/100" → task Done

### Eval

Planner only via W&B Weave.

- **Plan quality**: LLM-as-judge scores task decomposition
- **Code quality**: LLM-as-judge scores generated SDK code (without running it)
- **Self-improvement**: `.claude/skills/wandb-improve/` reads Weave scores, suggests prompt changes

### Key Files

| File                                        | Role                                 |
| ------------------------------------------- | ------------------------------------ |
| `src/lib/convex/todo/agent.ts`              | Agent definition + tools + SDK docs  |
| `src/lib/convex/todo/messages.ts`           | Thread messaging + agent trigger     |
| `src/lib/server/sandbox/script-executor.ts` | Node VM executor with Unipile facade |
| `src/routes/api/sandbox/execute/+server.ts` | Slim endpoint for code execution     |
| `docs/references/unipile-node-sdk/`         | Unipile SDK source (reference)       |

### Debugging Agent Runs

Agent threads live in the Convex Agent component. Add `--prod` for production, omit for dev.

```bash
# 1. Email → userId (internalQuery, no secret needed)
bun convex run 'tests:getTestUser' '{"email": "EMAIL"}' --prod
# Use the _id value from the output

# 2. List tasks + thread IDs
bun convex run 'todos:getBoardInternal' '{"userId": "USER_ID"}' --prod | python3 -c "
import json,sys;d=json.load(sys.stdin)
for c,ts in d.items():
 for t in ts: print(f'[{c}] thread={t.get(\"threadId\",\"none\")}  {t[\"title\"][:60]}')"

# 3. Dump thread → trace
bun convex run --component agent messages:listMessagesByThreadId \
  '{"threadId": "THREAD_ID", "order": "asc", "paginationOpts": {"cursor": null, "numItems": 100}}' \
  --prod > /tmp/thread.json && python3 scripts/parse-agent-trace.py /tmp/thread.json
```

The trace parser script is at `scripts/parse-agent-trace.py`.

## Plan Mode

- Make the plan extremely concise. Sacrifice grammar for the sake of concision.
- At the end of each plan, give me a list of unresolved questions to answer, if any, using the question tool.

## esbuild/Vite Error: The service was stopped

`bun i -f` should fix the issue.

## Lighthouse

### 1. Generate report

`npx lighthouse URL --only-categories=accessibility --output=json --chrome-flags="--headless=new" 2>/dev/null > /tmp/lh.json`

### 2. Query score + failing elements

`cat /tmp/lh.json | jq '{score: (.categories.accessibility.score*100|floor), failures: [.audits|to_entries[]|select(.value.score==0 and .value.scoreDisplayMode=="binary")|{id:.key,elements:[.value.details.items[]?|{selector:.node.selector,snippet:.node.snippet}]}]}'`

Swap accessibility for performance, seo, best-practices as needed.

---

## Job Application Kanban — Complete Project Guide

> **PRIORITY SECTION.** Read this before touching anything in `src/lib/components/todo-demo/` or `src/lib/convex/todo*/` or `src/lib/convex/todos.ts`. This documents the entire custom feature built on top of the SaaS template.

### What This App Actually Is

This is a **Job Application Kanban board** — not a generic task manager. Users drag job applications through 5 stages, and an AI agent (Nova) helps at each stage. The rest of the SaaS template (admin panel, auth, billing, etc.) is scaffolding around this core feature.

### Running the Dev Server (Windows / PowerShell)

`bun` is installed at `C:\Users\Mohammad\.bun\bin` and is NOT on the system PATH by default.

**Option A — scripts (recommended):**

```powershell
.\RUN\dev.ps1        # prepends bun to PATH and runs bun run dev
```

Or double-click `RUN\dev.bat`.

**Option B — manual:**

```powershell
$env:PATH = "C:\Users\Mohammad\.bun\bin;" + $env:PATH
bun run dev
```

**All other bun commands** in this project also need the PATH fix if running from a plain terminal. The dev server is already running during active development — never start a second instance.

### 5 Kanban Columns

| Column ID      | Label        | Icon              | Meaning                        |
| -------------- | ------------ | ----------------- | ------------------------------ |
| `targeted`     | Targeted     | CrosshairIcon     | Job spotted, not yet acted on  |
| `preparing`    | Preparing    | WrenchIcon        | Actively preparing application |
| `applied`      | Applied      | SendIcon          | Application submitted          |
| `interviewing` | Interviewing | MessageSquareIcon | In interview process           |
| `done`         | Done         | CircleCheckIcon   | Closed (hired / rejected)      |

**Board layout** (`src/lib/components/todo-demo/kanban-board.svelte`): `md:grid-cols-4` — Targeted, Preparing, Applied each occupy one column; Interviewing and Done are stacked vertically inside the 4th column.

### Key UI Files — Where Appearance Changes Go

These are the files you will edit 95% of the time for visual or UX changes:

| File                                                         | Role                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `src/lib/components/todo-demo/kanban-board.svelte`           | Main board, DnD orchestration, column layout, task selection, ChatGPT connection prompt  |
| `src/lib/components/todo-demo/kanban-column.svelte`          | Column header, add-task button, column edit button, task list rendering                  |
| `src/lib/components/todo-demo/kanban-item.svelte`            | **Card appearance** — company name, position, status indicators, "Processing…" label     |
| `src/lib/components/todo-demo/todo-detail-dialog.svelte`     | **Task detail dialog** — all fields, stage history, interview section, notes, agent logs |
| `src/lib/components/todo-demo/todo-add-form.svelte`          | Add task inline form (title + optional URL)                                              |
| `src/lib/components/todo-demo/chatgpt-connect-dialog.svelte` | Modal to connect OpenAI — required for Nova to work                                      |
| `src/lib/components/todo-demo/column-edit-dialog.svelte`     | Edit column name and custom instructions for Nova                                        |
| `src/lib/components/todo-demo/types.ts`                      | All TypeScript types — `TodoItem`, `ColumnId`, `KanbanData`, `AgentStatus`               |

#### Card Display Logic (`kanban-item.svelte`)

- **Line 1**: `companyName` if set, otherwise `title`. Shows `"Processing…"` when `agentStatus === 'working'`.
- **Line 2**: `position` (hidden while agent is working).
- Error/note indicators use icon badges bottom-right of card.
- Outer wrapper class MUST stay `relative w-full min-w-0 cursor-grab` — removing `min-w-0` causes cards to overflow the column.

#### Detail Dialog (`todo-detail-dialog.svelte`)

Most complex component. Key design decisions already made — do not reverse these:

- **Scrollbar**: `pr-6 [scrollbar-gutter:stable]` — required to prevent content shifting when scrollbar appears. Do not remove.
- **Stage history**: Shows 4 stages only — **Preparing / Applied / Interviewing / Done**. Targeted is intentionally excluded. Each shows the `*At` timestamp when the task first entered that column.
- **Interview section**: Three dedicated fields — `interviewDate` (datetime-local input), `interviewLink` (URL input), `interviewEmail` (textarea). These are saved to the task via `handleSave`.
- **Agent notes**: The notes textarea shows `hasUnreadNotes` indicator and clears the unread flag on open.

### Full TodoItem Field Reference

Every field stored per task. Grouped by purpose:

**Core:**

```ts
id: string           // client-generated UUID
title: string        // job title or free-form description
notes?: string       // user + agent shared notepad
order: number        // sort order within column
createdAt: number    // unix ms
updatedAt: number    // unix ms
columnId: ColumnId   // 'targeted' | 'preparing' | 'applied' | 'interviewing' | 'done'
```

**Column Entry Timestamps** (set once when task first enters that column):

```ts
targetedAt?: number
preparingAt?: number
appliedAt?: number
interviewingAt?: number
doneAt?: number
```

**Agent State:**

```ts
threadId?: string          // Convex Agent thread ID
agentStatus?: 'idle' | 'working' | 'done' | 'awaiting_approval' | 'error'
agentSummary?: string      // Short status shown on card (120 char max)
agentLogs?: string         // Full debug trace (4000 char max)
agentDraft?: string        // Draft content (letter, email, etc.)
agentDraftType?: 'message' | 'email' | 'research'
agentSpec?: string         // Internal agent spec
agentStartedAt?: number    // Timestamp when agent last started
hasUnreadNotes?: boolean   // True when agent updated notes since last user view
```

**Job-Specific Fields** (filled by Nova in Preparing mode):

```ts
companyName?: string
position?: string
jobUrl?: string
jobDescription?: string
skills?: string
country?: string
searchTerm?: string
postedDate?: string
jobLevel?: string
jobFunction?: string
jobType?: string
companyIndustry?: string
companyUrl?: string
platform?: string
motivationLetter?: string
```

**Interview Fields:**

```ts
interviewDate?: string     // ISO datetime string
interviewLink?: string     // Video call URL
interviewEmail?: string    // Interviewer email(s)
```

### Key Backend Files

| File                                   | Role                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/lib/convex/schema.ts`             | Database schema — `todoBoards` table with the full task shape above                                              |
| `src/lib/convex/todos.ts`              | All board mutations/queries — `saveBoard`, `getBoard`, `getColumnMeta`, internal helpers, agent trigger dispatch |
| `src/lib/convex/todo/agent.ts`         | Agent tool definitions (see tool list below)                                                                     |
| `src/lib/convex/todo/messages.ts`      | Agent run loop, prompt construction, trigger functions                                                           |
| `src/lib/convex/todo/threads.ts`       | Thread management helpers                                                                                        |
| `src/lib/convex/todo/notifications.ts` | Cross-task agent notification system                                                                             |

### Nova Agent — Two-Mode Behavior ⚠️ IMPORTANT

**This was the last major feature implemented.** The agent behaves differently depending on which column a task is in when it triggers.

#### Mode 1: Analysis Mode (`targeted` column)

Triggered when:

- A new task is created directly into `targeted`
- A task is moved back to `targeted` from another column

Agent behavior:

1. Reads task title and any notes/URL
2. Uses `webSearch` to fetch the job posting if a URL is provided
3. Identifies which fields are missing (company, skills, salary, deadline, etc.)
4. Writes a structured consultation summary to notes via `updateMyNotes`
5. **Does NOT** call `updateJobFields`
6. **Does NOT** write a motivation letter
7. **Does NOT** call `moveMyTask`
8. Stays in Targeted — this is advisory only

#### Mode 2: Full Action Mode (`preparing` column and others)

Triggered when:

- A new task is created directly into `preparing` (or any non-targeted column)
- A task is moved from any column to `preparing`
- A task is moved between applied/interviewing/done

Agent behavior:

1. Calls `getUserProfile` to read the user's resume
2. Parses the full job description
3. Calls `updateJobFields` to fill all available fields
4. Writes a personalised motivation letter
5. Saves everything to notes via `updateMyNotes`
6. May call `moveMyTask` as appropriate

#### Where the mode logic lives

- **New task** → `triggerAgentForNewTask` in `messages.ts` (line ~591): branches on `args.taskColumn === 'targeted'`
- **Column change** → `saveBoard` mutation in `todos.ts` (line ~446): builds `columnMovePrompt` based on `task.columnId`
- **Deferred detection** → after agent run completes, `runTodoAgentForTask` checks `taskInfo?.columnId === 'targeted'` and sets `agentStatus = 'idle'` (not 'done') so no cascade fires

### Nova Agent Tools

All defined in `src/lib/convex/todo/agent.ts`:

| Tool              | What it does                                                           |
| ----------------- | ---------------------------------------------------------------------- |
| `updateMyNotes`   | Write/replace the task's notes field                                   |
| `updateJobFields` | Fill job-specific fields (companyName, position, jobUrl, skills, etc.) |
| `getUserProfile`  | Read the user's stored resume/profile                                  |
| `createTask`      | Create a new task card on the board                                    |
| `moveMyTask`      | Move this task to a different column                                   |
| `setMyTaskUI`     | Set `agentDraft` and `agentDraftType`                                  |
| `notifyTask`      | Send a notification message to another task's agent thread             |
| `readTaskNotes`   | Read full notes (bypasses the 300-char truncation in prompt)           |
| `webSearch`       | Search the web (used to fetch job postings from URLs)                  |

### ChatGPT Connection Requirement

Nova will not trigger unless the user has connected their OpenAI account. This is checked in `saveBoard` via:

```ts
const hasOpenai = !!(await ctx.db.query('openaiConnections').withIndex('by_user', ...).first());
```

The board shows a connect dialog if not connected. Dismiss state is stored in `localStorage` under `JobFlow:chatgpt-connect-dismissed`. The connection is managed via `src/lib/components/todo-demo/chatgpt-connect-dialog.svelte`.

### Lessons Learned — Gotchas for Next Agent

**DO NOT break these:**

- `applyColumnGuard` in `messages.ts` is a **passthrough** (gutted/intentional). It looks like it does column validation but it does not. Do not try to "fix" it.
- `deferred = taskInfo?.columnId === 'targeted'` in the run loop is **intentional**. When a task is still in Targeted after the agent runs, it's set to `idle` (not `done`) and no cascade fires. This is correct behavior for Analysis Mode.
- Card outer wrapper MUST have `min-w-0` — without it, long titles cause cards to overflow columns.
- Dialog PR must stay `pr-6 [scrollbar-gutter:stable]` — this prevents layout shift when scrollbar appears.

**PATH issues (Windows):**

- `bun` is not on system PATH in PowerShell by default.
- Always use `.\RUN\dev.ps1` or prepend `C:\Users\Mohammad\.bun\bin` manually.
- `bun run check` will silently do nothing if bun isn't found — always verify it ran.

**Schema changes:**

- After any change to `src/lib/convex/schema.ts`, run `bun run generate` to regenerate `convex/_generated/`.
- The `todoBoards` tasks array is typed inline in the schema — changes there must be mirrored in `src/lib/components/todo-demo/types.ts` and `src/lib/convex/todos.ts` (`taskValidator` and `BoardTask`/`StoredTask` types).

**Icon imports:**

- Never `import { CrosshairIcon } from '@lucide/svelte'` — use `import CrosshairIcon from '@lucide/svelte/icons/crosshair'`.

**i18n for UI text:**

- The Kanban board currently uses hardcoded English labels for column names in `kanban-board.svelte` (`COLUMN_LABELS` map). These are NOT yet translated. Custom column names are stored in Convex via `columnMeta`. If adding new hardcoded UI strings to this feature, check whether i18n is needed.

**Agent prompt truncation:**

- Task notes are truncated to 300 chars in the prompt with a hint to use `readTaskNotes`. The agent must call `readTaskNotes` to get the full content when writing follow-up notes.

### Convex Deployment

- **Dev**: `merry-impala-369`
- Run Convex CLI for dev: `bun convex dev` (or it runs as part of `bun run dev`)
- Run Convex CLI for prod: append `--prod` to any `bun convex` command
