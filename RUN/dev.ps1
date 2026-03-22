# Promus – Start dev server from PowerShell
# Usage: .\RUN\dev.ps1   (from project root)
#        or just double-click dev.bat

$env:PATH = "C:\Users\Mohammad\.bun\bin;" + $env:PATH
Set-Location (Split-Path $PSScriptRoot -Parent)
bun run dev


# C:\Users\Mohammad\.bun\bin\bun.exe run build
# C:\Users\Mohammad\.bun\bin\bun.exe run check
# C:\Users\Mohammad\.bun\bin\bun.exe x convex deploy
