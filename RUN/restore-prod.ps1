# JobPilot – Restore Convex env vars to production values
# Run this before deploying to production (after using dev.ps1 locally).
# Usage: .\RUN\restore-prod.ps1   (from project root)

$env:PATH = "C:\Users\Mohammad\.bun\bin;" + $env:PATH
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "[prod] Restoring Convex env vars to production..." -ForegroundColor Cyan
bunx convex env set SITE_URL https://jobflow-wine-gamma.vercel.app
bunx convex env set EMAIL_ASSET_URL https://jobflow-wine-gamma.vercel.app

Write-Host "[prod] Done. Convex env is now pointing to the production URL." -ForegroundColor Green
