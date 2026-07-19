@echo off
:: ─────────────────────────────────────────────
::  JobPilot – Start local frontend with Railway Convex
::  Double-click this file or run it from CMD.
:: ─────────────────────────────────────────────
cd /d "%~dp0.."
echo Starting dev server...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\RUN\dev.ps1"
pause
