# JobPilot – Repair Railway Convex URL environment variables
# Local development no longer changes these values. Run only if they were
# accidentally changed or after configuring a fresh Railway Convex instance.
# Usage: .\RUN\restore-prod.ps1   (from project root)

$env:PATH = "C:\Users\Mohammad\.bun\bin;" + $env:PATH
Set-Location (Split-Path $PSScriptRoot -Parent)

$railwayEnv = ".env.railway-convex.local"
if (-not (Test-Path $railwayEnv)) {
    throw "Missing $railwayEnv. Railway Convex credentials are required."
}

Get-Content $railwayEnv | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
        $parts = $line.Split('=', 2)
        [Environment]::SetEnvironmentVariable(
            $parts[0].Trim(),
            $parts[1].Trim().Trim('"').Trim("'"),
            'Process'
        )
    }
}

Write-Host "[prod] Restoring Railway Convex URL env vars..." -ForegroundColor Cyan
bunx convex env set SITE_URL https://jobpilot.oploy.eu
if ($LASTEXITCODE -ne 0) { throw "Failed to set SITE_URL" }
bunx convex env set EMAIL_ASSET_URL https://jobpilot.oploy.eu
if ($LASTEXITCODE -ne 0) { throw "Failed to set EMAIL_ASSET_URL" }
bunx convex env set BETTER_AUTH_TRUSTED_ORIGINS "https://jobpilot.oploy.eu,http://localhost:5173,http://127.0.0.1:5173"
if ($LASTEXITCODE -ne 0) { throw "Failed to set BETTER_AUTH_TRUSTED_ORIGINS" }

Write-Host "[prod] Railway Convex URLs and trusted origins are correct." -ForegroundColor Green
