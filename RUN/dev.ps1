# JobPilot – Start dev server from PowerShell
# Usage: .\RUN\dev.ps1   (from project root)
#        or just double-click dev.bat

$env:PATH = "C:\Users\Mohammad\.bun\bin;" + $env:PATH
Set-Location (Split-Path $PSScriptRoot -Parent)

# ── Convex backend ────────────────────────────────────────────────────────────
# Local SvelteKit connects to the shared Railway-hosted Convex instance through
# the URLs in `.env.local`. Do NOT change Convex SITE_URL to localhost: SITE_URL
# is global to the shared backend and must remain the production HTTPS origin.
#
# Local auth works through `/api/auth/*`, which proxies to Railway. The proxy
# translates Railway's secure auth cookies for localhost HTTP. Railway Better
# Auth must include http://localhost:5173 in BETTER_AUTH_TRUSTED_ORIGINS.
Write-Host "[dev] Using Railway Convex from .env.local (SITE_URL stays production)." -ForegroundColor Cyan

# ── Personal Job Search backend (FastAPI on :8000) ────────────────────────────
# Required for the My Job Search page (/app/my-job-search) to work.
$backendPath = Resolve-Path "$PSScriptRoot\..\..\job-personal-search" -ErrorAction SilentlyContinue
if ($backendPath) {
    Write-Host "[dev] Starting FastAPI personal-search backend in new window..." -ForegroundColor Cyan
    Start-Process pwsh -ArgumentList "-NoExit", "-Command",
        "Set-Location '$backendPath'; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --port 8000"
} else {
    Write-Host "[dev] job-personal-search not found, skipping FastAPI backend." -ForegroundColor Yellow
}

# ── SvelteKit dev ──────────────────────────────────────────────────────────────
# Do not start `convex dev` here: it targets a separate local/anonymous Convex
# backend and will not contain the Railway data, environment variables, or
# component state.
bun run dev:frontend




# ── Useful one-off commands (reference) ──────────────────────────────────────
# C:\Users\Mohammad\.bun\bin\bun.exe run build
# C:\Users\Mohammad\.bun\bin\bun.exe run check
# C:\Users\Mohammad\.bun\bin\bun.exe x convex deploy



# Backend:
# bun run generate
# bunx convex deploy

# If `bunx convex deploy` still gives trouble, try:
# `bun run convex deploy`

##############3 convex deployment ############
# $env:PATH = "C:\Users\Mohammad\.bun\bin;" + $env:PATH
# bun convex deploy --typecheck enable