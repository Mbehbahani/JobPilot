#!/usr/bin/env bash
# Restore production settings on the Huawei Convex deployment.
#
# RUN THIS ONLY AT CUTOVER, immediately before switching DNS. Until it runs, the
# destination physically cannot send email or bill anyone, because its Resend and
# Autumn keys are inert placeholders.
#
# It reads the real values from the SOURCE deployment and writes them to the
# DESTINATION. No secret is ever printed or stored in this file.
#
# Usage:  bash infra/huawei-convex/activate-production-env.sh
# Dry run: DRY_RUN=1 bash infra/huawei-convex/activate-production-env.sh

set -euo pipefail

SRC_URL="https://convex-cloud.oploy.eu"
DST_URL="http://10.130.231.5:3210"
CONVEX="./node_modules/.bin/convex"
ADMIN_KEY="$(grep -m1 '^CONVEX_SELF_HOSTED_ADMIN_KEY=' infra/aws-convex/deploy/.env | cut -d= -f2-)"

[ -n "$ADMIN_KEY" ] || { echo "FATAL: admin key not found"; exit 1; }
case "$DST_URL" in *10.130.231.5*) ;; *) echo "FATAL: destination is not the Huawei server"; exit 1;; esac

src() { CONVEX_SELF_HOSTED_URL="$SRC_URL" CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY" "$CONVEX" "$@"; }
dst() { CONVEX_SELF_HOSTED_URL="$DST_URL" CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY" "$CONVEX" "$@"; }

# NEVER echo "$@" here: for `env set` the last argument is the secret value.
# Print only the action and the variable name.
run() {
  if [ "${DRY_RUN:-0}" = "1" ]; then
    echo "  [dry-run] would: convex $1 $2 ${3:-} <value withheld>"
  else
    dst "$@" >/dev/null
  fi
}

echo "== 1. Restore the real third-party credentials (copied source -> destination) =="
for VAR in RESEND_API_KEY RESEND_WEBHOOK_SECRET AUTUMN_SECRET_KEY; do
  VALUE="$(src env get "$VAR" 2>/dev/null || true)"
  if [ -z "$VALUE" ]; then
    echo "  !! $VAR is empty on the source - SKIPPED, check manually"
    continue
  fi
  run env set "$VAR" "$VALUE"
  echo "  $VAR restored (len ${#VALUE}, value not shown)"
done

echo
echo "== 2. Restore production origins and trusted origins =="
TRUSTED="$(src env get BETTER_AUTH_TRUSTED_ORIGINS 2>/dev/null || true)"
[ -n "$TRUSTED" ] && { run env set BETTER_AUTH_TRUSTED_ORIGINS "$TRUSTED"; echo "  BETTER_AUTH_TRUSTED_ORIGINS restored from source"; }

SITE_URL_SRC="$(src env get SITE_URL 2>/dev/null || true)"
[ -n "$SITE_URL_SRC" ] && { run env set SITE_URL "$SITE_URL_SRC"; echo "  SITE_URL = $SITE_URL_SRC"; }

EMAIL_ASSET_SRC="$(src env get EMAIL_ASSET_URL 2>/dev/null || true)"
[ -n "$EMAIL_ASSET_SRC" ] && { run env set EMAIL_ASSET_URL "$EMAIL_ASSET_SRC"; echo "  EMAIL_ASSET_URL = $EMAIL_ASSET_SRC"; }

echo
echo "== 3. Remove the e2e test secret - it must NOT exist on a production backend =="
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "  [dry-run] would: dst env remove AUTH_E2E_TEST_SECRET"
else
  dst env remove AUTH_E2E_TEST_SECRET >/dev/null 2>&1 && echo "  AUTH_E2E_TEST_SECRET removed" \
    || echo "  AUTH_E2E_TEST_SECRET was not set (fine)"
fi

echo
echo "== 4. Point the container at its public identity =="
echo "  Update ~/convex-huawei/.env on the server, then restart:"
cat <<'EOF'
    ssh sohamoha@10.130.231.5
    cd ~/convex-huawei
    sed -i 's|^CONVEX_CLOUD_ORIGIN=.*|CONVEX_CLOUD_ORIGIN=https://convex-cloud.oploy.eu|' .env
    sed -i 's|^CONVEX_SITE_ORIGIN=.*|CONVEX_SITE_ORIGIN=https://convex-site.oploy.eu|' .env
    docker compose up -d
EOF

echo
echo "== 5. Verify (names only, no values) =="
if [ "${DRY_RUN:-0}" != "1" ]; then
  echo "  destination env var names:"
  dst env list 2>/dev/null | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/    \1/p' | sort
  echo
  echo "  AUTH_E2E_TEST_SECRET still present? (expect: no output)"
  dst env list 2>/dev/null | grep '^AUTH_E2E_TEST_SECRET=' || echo "    correctly absent"
fi

echo
echo "Done. Routing has NOT been changed - that is a manual Cloudflare step."
