# JobPilot – Start dev server from PowerShell
# Usage: .\RUN\dev.ps1   (from project root)
#        or just double-click dev.bat

$env:PATH = "C:\Users\Mohammad\.bun\bin;" + $env:PATH
Set-Location (Split-Path $PSScriptRoot -Parent)

# ── Convex env: point to localhost for local dev ──────────────────────────────
# SITE_URL      → BetterAuth uses this for OAuth redirect URLs
# EMAIL_ASSET_URL → Resend email templates use this for verification links
# NOTE: This mutates the Convex cloud deployment (CONVEX_DEPLOYMENT_PLACEHOLDER).
#       Run .\RUN\restore-prod.ps1 before deploying to production.
Write-Host "[dev] Setting Convex env vars for local dev..." -ForegroundColor Cyan
# bunx convex env set SITE_URL http://localhost:5173
# bunx convex env set EMAIL_ASSET_URL http://localhost:5173

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

# ── SvelteKit + Convex dev ────────────────────────────────────────────────────
bun run dev


# ── Useful one-off commands (reference) ──────────────────────────────────────
# C:\Users\Mohammad\.bun\bin\bun.exe run build
# C:\Users\Mohammad\.bun\bin\bun.exe run check
# C:\Users\Mohammad\.bun\bin\bun.exe x convex deploy
