@echo off
:: ─────────────────────────────────────────────
::  JobFlow – Start dev server (Vite + Convex)
::  Double-click this file or run it from CMD.
:: ─────────────────────────────────────────────
set "PATH=C:\Users\Mohammad\.bun\bin;%PATH%"
cd /d "%~dp0.."
echo Starting dev server...
bun run dev
pause
