# JobPilot – Local Development Guide 2

> **JobPilot** is a Kanban board where each task can have an AI agent ("Coda") that uses connected accounts (email, LinkedIn, etc.) to perform real work via the Unipile SDK.

---

## Table of Contents

1. [How the Code Works](#1-how-the-code-works)
2. [Project Structure](#2-project-structure)
3. [Required Secrets](#3-required-secrets)
4. [Running Locally](#4-running-locally)
5. [What's Already Configured (Your Setup)](#5-whats-already-configured-your-setup)
6. [Codex CLI Login Fix](#6-codex-cli-login-fix)

---

## 1. How the Code Works

### Architecture

```
Browser (SvelteKit)
       │
       ▼
Convex Cloud (Backend)
  ├── Real-time DB (tables, queries, mutations)
  ├── Better Auth (sessions, email verification, OAuth)
  ├── Resend Component (email delivery with retry)
  ├── Workpool (background job queue)
  └── Agent (Claude Opus via Convex Agent)
             │
             ▼ POST /api/sandbox/execute
Vercel Serverless Function
  └── Node.js VM (executes Unipile SDK code in isolation)
             │
             ▼
Unipile API (email, LinkedIn, messaging actions)
```

### Request Flow – Sign Up

1. User fills in name / email / password on `/signin?tab=signup`
2. SvelteKit calls `authClient.signUp.email()` (Better Auth client)
3. Better Auth routes hit Convex HTTP endpoint (`/api/auth/*`)
4. Convex creates the user record via `betterAuth` component adapter
5. Convex triggers `emailVerification.sendVerificationEmail` → schedules `internal.emails.send.sendVerificationEmail`
6. The Resend workpool picks up the job and calls the Resend API
7. User clicks the link in their email → lands on `/email-verified` → redirected to `/app`

### Request Flow – Kanban Task Agent

1. User creates a task card on the Kanban board
2. Task moves to "Working On" column → triggers `internal.todo.messages.triggerAgent`
3. The Convex Agent (Claude Opus 4.6) receives the task title + instructions
4. Agent generates TypeScript code using the Unipile SDK
5. Agent calls `executeUnipileCode` tool → POST to `/api/sandbox/execute` with the code
6. Vercel serverless sandboxes the code in a Node VM with an Unipile SDK facade
7. Results come back → agent writes a reply → task moves to "Done"

### Key Directories

| Path | Purpose |
|---|---|
| `src/routes/[[lang]]/` | SvelteKit pages with i18n support |
| `src/routes/(app)/` | Authenticated app routes (Kanban board) |
| `src/routes/[[lang]]/(auth)/` | Login / signup / reset password pages |
| `src/lib/convex/` | All Convex backend (schema, queries, mutations, actions) |
| `src/lib/convex/auth.ts` | Better Auth setup, email verification, user triggers |
| `src/lib/convex/emails/` | Email sending via Resend component |
| `src/lib/convex/todo/` | Kanban task logic + AI agent (`agent.ts`) |
| `src/lib/components/` | Reusable Svelte UI components (shadcn-svelte based) |
| `src/i18n/` | Translation files (en/de/es/fr) |
| `docs/references/` | SDK reference docs for Unipile, Daytona, Mistral |

---

## 2. Project Structure

```
JobPilot/
├── src/
│   ├── routes/              # SvelteKit pages
│   ├── lib/
│   │   ├── convex/          # Backend: schema, auth, emails, agent
│   │   ├── components/      # UI components
│   │   ├── hooks/           # Svelte rune-based utilities
│   │   └── i18n/            # Tolgee setup
│   └── i18n/                # Translation JSON files
├── .env.local               # Frontend env vars (Vite / SvelteKit)
├── .env.convex.local        # Reference for Convex backend secrets
├── convex.json              # Points Convex to src/lib/convex/
├── vite.config.ts           # Vite / SvelteKit build config
└── package.json             # Scripts & dependencies
```

---

## 3. Required Secrets

Secrets live in **two places**: frontend (`.env.local`) and backend (Convex deployment env).

### 3A. Convex Backend Secrets

Set via CLI: `bun convex env set KEY value`

| Variable | Required | What it does | Where to get it |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | ✅ | Signs all auth sessions and tokens | Generate: `openssl rand -base64 32` |
| `SITE_URL` | ✅ | Base URL for OAuth redirects and deep links | `http://localhost:5173` locally |
| `EMAIL_ASSET_URL` | ✅ | Base URL for email images/logos | `http://localhost:5173` locally |
| `AUTH_EMAIL` | ✅ | "From" address for all emails sent by the app | Must be verified in Resend. Use `onboarding@resend.dev` for testing |
| `RESEND_API_KEY` | ✅ | Sends transactional emails (verification, reset, notifications) | [resend.com/api-keys](https://resend.com/api-keys) |
| `RESEND_WEBHOOK_SECRET` | ✅ | Verifies Resend webhook payloads for delivery tracking | Resend Dashboard → Webhooks → Signing Secret |
| `AUTUMN_SECRET_KEY` | ✅ | Billing / subscription features (Autumn) | [useautumn.com](https://useautumn.com) → Settings → API Keys |
| `AUTH_GOOGLE_ID` | ⬜ Optional | Google OAuth login | Google Cloud Console → Credentials |
| `AUTH_GOOGLE_SECRET` | ⬜ Optional | Google OAuth login | Google Cloud Console → Credentials |
| `AUTH_GITHUB_ID` | ⬜ Optional | GitHub OAuth login | GitHub → Settings → OAuth Apps |
| `AUTH_GITHUB_SECRET` | ⬜ Optional | GitHub OAuth login | GitHub → Settings → OAuth Apps |
| `AUTH_E2E_TEST_SECRET` | ⬜ Testing | Allows Playwright to create/delete test users | Any random string |
| `SANDBOX_URL` | ⬜ Agent | URL of the Vercel sandbox function | Your Vercel deployment URL |
| `SANDBOX_INTERNAL_API_KEY` | ⬜ Agent | Shared secret for Convex → sandbox calls | Generate: `openssl rand -hex 32` |
| `SUPPORT_LLM_PROVIDER` | ⬜ Optional | AI support provider: `bedrock` or `openrouter` | — |
| `AWS_BEARER_TOKEN_BEDROCK` | ⬜ Optional | AWS Bedrock API key for support AI | AWS Console → Bedrock |
| `AWS_REGION` | ⬜ Optional | AWS region for Bedrock | e.g. `us-west-2` |
| `OPENROUTER_API_KEY` | ⬜ Optional | OpenRouter key (alternative to Bedrock) | [openrouter.ai](https://openrouter.ai) |
| `UNIPILE_DSN` | ⬜ Agent | Unipile connection string for account integrations | Unipile dashboard |
| `UNIPILE_API_KEY` | ⬜ Agent | Authenticates Unipile SDK calls | Unipile dashboard |

### 3B. Frontend Secrets (`.env.local`)

| Variable | Required | What it does |
|---|---|---|
| `CONVEX_DEPLOYMENT` | ✅ | Identifies which Convex deployment to use (auto-set by `bun run dev`) |
| `PUBLIC_CONVEX_URL` | ✅ | Convex cloud URL for data queries/realtime |
| `PUBLIC_CONVEX_SITE_URL` | ✅ | Convex HTTP endpoint URL (for Better Auth routes) |
| `VITE_TOLGEE_API_KEY` | ⬜ Optional | In-context translation editing in dev mode |
| `PUBLIC_POSTHOG_API_KEY` | ⬜ Optional | Analytics tracking |
| `SANDBOX_INTERNAL_API_KEY` | ⬜ Agent | Must match the Convex `SANDBOX_INTERNAL_API_KEY` |

### 3C. Currently Applied Secrets (Your Dev Setup)

**Convex backend (already set via `bun convex env set`):**

```
BETTER_AUTH_SECRET   = RruABBsuZ1op2fVuXDrl+...
SITE_URL             = http://localhost:5173
EMAIL_ASSET_URL      = http://localhost:5173
AUTH_EMAIL           = onboarding@resend.dev       ← fixed (was noreply@send.oploy.eu, domain unverified)
RESEND_API_KEY       = re_HVqT6Dv2_...
RESEND_WEBHOOK_SECRET= whsec_eFdak1v+...
AUTUMN_SECRET_KEY    = am_sk_live_...
AUTH_E2E_TEST_SECRET = local-test-secret-123
```

**Frontend (`.env.local`):**

```
CONVEX_DEPLOYMENT    = CONVEX_DEPLOYMENT_PLACEHOLDER
PUBLIC_CONVEX_URL    = PUBLIC_CONVEX_URL_PLACEHOLDER
PUBLIC_CONVEX_SITE_URL = PUBLIC_CONVEX_SITE_URL_PLACEHOLDER
```

> **Note:** `AUTH_EMAIL` was changed from `noreply@send.oploy.eu` to `onboarding@resend.dev`
> because the `send.oploy.eu` domain is not verified under the current Resend account.
> `onboarding@resend.dev` is Resend's built-in test domain — no verification needed, but
> emails can only be sent to the email address registered with your Resend account.

### 3D. Incident Note (Apr 2026): Verification Emails Not Sending

This issue happened in production and is documented here to avoid repeat outages.

**Symptoms:**

- User signup worked, but no verification email was delivered.
- Resend logs showed `403 validation_error` with: `The domain send.oploy.eu is not verified`.
- Email HTML used `http://localhost:5173` for logo/footer links in production emails.

**Root Causes:**

- `AUTH_EMAIL` used an unverified sender subdomain (`noreply@send.oploy.eu`).
- `EMAIL_ASSET_URL` was left on localhost in production (`http://localhost:5173`).
- Frontend redeploy confusion: Netlify env changes do not fix Convex email env values.

**Fix Applied:**

```bash
# Convex env changes apply immediately; no Convex redeploy needed for env updates.
bun convex env set AUTH_EMAIL noreply@oploy.eu
bun convex env set EMAIL_ASSET_URL https://jobpilot.oploy.eu
bun convex env set SITE_URL https://jobpilot.oploy.eu/
```

**Verification Checklist:**

1. Confirm current Convex env values:

```bash
bun convex env list
```

Expected:

- `AUTH_EMAIL=noreply@oploy.eu`
- `EMAIL_ASSET_URL=https://jobpilot.oploy.eu`
- `SITE_URL=https://jobpilot.oploy.eu/`

2. Confirm the sender domain is verified in Resend (Domains page).

3. Re-test signup with a fresh user (or delete and recreate test account).

4. Check Resend logs for `POST /emails/batch` success and delivery events.

**Important Deployment Note:**

- Netlify env updates require a new Netlify deploy to affect frontend runtime.
- Convex env updates via `bun convex env set` apply immediately to backend email flow.

---

## 4. Running Locally

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| **Bun** | ≥ 1.1 | `curl -fsSL https://bun.sh/install \| bash` (Mac/Linux) or [bun.sh](https://bun.sh) (Windows) |
| **Node.js** | ≥ 18 | [nodejs.org](https://nodejs.org) (used by some sub-tools) |
| A **Convex account** | — | [convex.dev](https://convex.dev) – free tier is fine |
| A **Resend account** | — | [resend.com](https://resend.com) – free tier sends 3,000 emails/month |
| An **Autumn account** | — | [useautumn.com](https://useautumn.com) – for billing features |

### Step-by-step

```bash
# 1. Install dependencies
bun install

# 2. Ensure .env.local exists with Convex URL
# Already done for this project — values are in place.

# 3. Set Convex backend secrets (already done for this project)
# bun convex env set BETTER_AUTH_SECRET "..."
# bun convex env set AUTH_EMAIL "onboarding@resend.dev"
# etc. (see .env.convex.local for reference values)

# 4. Start dev servers (frontend + Convex backend watcher)
bun run dev
```

This runs two concurrent processes:
- **Vite dev server** on `http://localhost:5173` (SvelteKit frontend)
- **Convex dev watcher** syncing your backend code to `merry-impala-369` deployment

### Available Scripts

| Command | What it does |
|---|---|
| `bun run dev`  | Start frontend + Convex backend watcher |
| `bun run build` | Production build |
| `bun run check` | TypeScript / Svelte type check |
| `bun run generate` | Regenerate Convex types (run after schema changes) |
| `bun run format` | Format code with Prettier |
| `bun run test:unit` | Run Vitest unit tests |
| `bun run test:e2e` | Run Playwright E2E tests |
| `bun run i18n:pull` | Download latest translations from Tolgee Cloud |
| `bun run i18n:push` | Upload local translations to Tolgee Cloud |

### First Run Checklist

- [ ] `bun install` completed without errors
- [ ] `.env.local` has `PUBLIC_CONVEX_URL` and `PUBLIC_CONVEX_SITE_URL`
- [ ] Convex backend vars are set (`bun convex env list`)
- [ ] `AUTH_EMAIL` is `onboarding@resend.dev` (or a verified Resend domain)
- [ ] App opens at `http://localhost:5173`
- [ ] Sign up → verification email arrives in inbox
- [ ] Click verification link → redirected to `/app`

---

## 5. What's Already Configured (Your Setup)

This project is pre-configured to use the `merry-impala-369` Convex deployment.

| What | Status |
|---|---|
| Convex deployment | ✅ `merry-impala-369` (dev, free tier) |
| Email sending | ✅ Resend with `onboarding@resend.dev` |
| Auth | ✅ Better Auth with email/password + email verification |
| Billing | ✅ Autumn connected |
| OAuth (Google/GitHub) | ❌ Not configured (optional) |
| AI Agent (Coda) | ❌ Needs `SANDBOX_URL` and `UNIPILE_API_KEY` to use |
| Translations | ✅ Bundled EN/DE/ES/FR (no Tolgee key needed for dev) |
| Analytics | ❌ PostHog not configured (optional) |

---

## 6. Codex CLI Login Fix

You saw this error:

> **"Enable device code authorization for Codex in ChatGPT Security Settings, then run `codex login --device-auth` again."**

### Steps to fix

1. **In ChatGPT/OpenAI settings (you said you already did this):**
   - Go to [chatgpt.com](https://chatgpt.com) → Your profile → **Settings → Security**
   - Enable **"Device code authorization"** (or "CLI access")

2. **Run the login command in your terminal:**

   ```bash
   codex login --device-auth
   ```

   Codex will display a code like `XXXX-XXXX` and open a browser page at `https://auth.openai.com/device`

3. **In the browser**, enter the code and authorize the device

4. Codex CLI will now be authenticated and you can use it with:

   ```bash
   codex "your prompt here"
   ```

> **Note:** This Codex CLI (`codex.ps1` found in your PATH) is separate from the OpenCode AI editor (`opencode.jsonc`). OpenCode uses Claude Opus via Anthropic — it does not require this Codex/OpenAI login.


bun run dev

---

## 7. JobLab Analytics ↔ Kanban Integration

The job-analytics-frontend dashboard can send jobs directly to this Kanban board.

### How It Works

```
job-analytics-frontend (Next.js :3000)
  │
  ├── /api/kanban/apply           → Proxy → POST /api/integration/add-job
  └── /api/kanban/check-duplicate → Proxy → POST /api/integration/check-duplicate
  │
  └──► Convex HTTP endpoints on JobPilot
```

### Environment Variables

#### In job-analytics-frontend (`.env.local` or `.env`)

| Variable | Purpose | Local Dev | Production |
|---|---|---|---|
| `JOBPILOT_CONVEX_SITE_URL` | Convex HTTP endpoint URL for API proxy routes | `PUBLIC_CONVEX_SITE_URL_PLACEHOLDER` (default) | Your Convex deployment's site URL |
| `JOBPILOT_INTEGRATION_API_KEY` | Bearer token for authenticating API requests | Empty (no auth locally) | Set to match `INTEGRATION_API_KEY` on Convex |
| `NEXT_PUBLIC_KANBAN_URL` | URL for the "Kanban" button in the header | `http://localhost:5173` (default) | Your Vercel deployment URL, e.g. `https://jobpilot.oploy.eu` |

#### In JobPilot Convex backend (`bun convex env set`)

| Variable | Purpose |
|---|---|
| `INTEGRATION_API_KEY` | API key to validate incoming requests from analytics frontend |
| `INTEGRATION_USER_ID` | (Optional) Target user ID for created cards. If unset, uses first board owner |

### Changing the Kanban Button URL

The **Kanban** button in the analytics header links to the Kanban app. The URL defaults to `http://localhost:5173` for local development:

- **Local dev**: No change needed — defaults to `http://localhost:5173`
- **Production/Vercel**: Set `NEXT_PUBLIC_KANBAN_URL` in your Vercel environment variables:
  ```
  NEXT_PUBLIC_KANBAN_URL=https://your-kanban-app.vercel.app
  ```
- **Custom domain**: Set it to your custom domain:
  ```
  NEXT_PUBLIC_KANBAN_URL=https://kanban.yourdomain.com
  ```

### Changing the Convex API URL

The proxy routes (`/api/kanban/apply`, `/api/kanban/check-duplicate`) forward requests to the Convex HTTP endpoint. The default is `PUBLIC_CONVEX_SITE_URL_PLACEHOLDER`:

- **Using a different Convex deployment**: Set `JOBPILOT_CONVEX_SITE_URL` in job-analytics-frontend:
  ```
  JOBPILOT_CONVEX_SITE_URL=https://your-deployment-name.convex.site
  ```
- **Securing the API in production**: Set both sides:
  ```bash
  # In job-analytics-frontend .env
  JOBPILOT_INTEGRATION_API_KEY=your-secret-key

  # In Convex backend
  bun convex env set INTEGRATION_API_KEY your-secret-key
  ```