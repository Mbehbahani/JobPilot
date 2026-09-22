#!/usr/bin/env bash
# Final consistent transfer: source -> Huawei, with verification.
#
# Run this AFTER the source backend has been stopped, so the snapshot is final.
# It refuses to write anywhere except the Huawei server.
#
# Usage: bash infra/huawei-convex/cutover-sync.sh

set -euo pipefail

SRC_URL="https://convex-cloud.oploy.eu"
DST_URL="http://10.130.231.5:3210"
CONVEX="./node_modules/.bin/convex"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BK="/c/Backups/jobpilot-convex/cutover-$STAMP"
CMP="C:/Users/PC/AppData/Local/Temp/claude/d--My-Vault/83cbd945-a380-4933-b29c-37d821d579ee/scratchpad/compare_snapshots.py"

ADMIN_KEY="$(grep -m1 '^CONVEX_SELF_HOSTED_ADMIN_KEY=' infra/aws-convex/deploy/.env | cut -d= -f2-)"
[ -n "$ADMIN_KEY" ] || { echo "FATAL: admin key not found"; exit 1; }

# Guard: every write must target the Huawei server and nothing else.
case "$DST_URL" in *10.130.231.5*) ;; *) echo "FATAL: destination is not Huawei"; exit 1;; esac

mkdir -p "$BK"
echo "backup dir: $BK"

echo
echo "== 1. Final snapshot from the SOURCE (read-only) =="
CONVEX_SELF_HOSTED_URL="$SRC_URL" CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY" \
  "$CONVEX" export --include-file-storage --path "$BK/final-snapshot.zip"
( cd "$BK" && sha256sum final-snapshot.zip | tee SHA256SUMS.txt )

echo
echo "== 2. Import into the DESTINATION ($DST_URL) =="
CONVEX_SELF_HOSTED_URL="$DST_URL" CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY" \
  "$CONVEX" import --replace-all --yes "$BK/final-snapshot.zip"

echo
echo "== 3. Re-export from the destination and compare =="
CONVEX_SELF_HOSTED_URL="$DST_URL" CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY" \
  "$CONVEX" export --include-file-storage --path "$BK/post-cutover-verify.zip"
( cd "$BK" && sha256sum post-cutover-verify.zip >> SHA256SUMS.txt )

echo
echo "== 4. GATE: fidelity comparison =="
if python "$CMP" "$BK/final-snapshot.zip" "$BK/post-cutover-verify.zip" | tee "$BK/comparison.txt" | tail -12; then
  echo
  echo "GATE PASSED. Safe to proceed to the production env swap and the DNS switch."
else
  echo
  echo "*** GATE FAILED - DO NOT SWITCH DNS. Follow the rollback in ACTIVATION-RUNBOOK.md Phase 2. ***"
  exit 1
fi

echo
echo "Evidence kept in: $BK"
