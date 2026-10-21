#!/usr/bin/env bash
# Smoke-test a running router (default http://localhost:8080).
# Set ROUTER_API_KEY in your environment if the server requires auth.
set -euo pipefail

BASE="${BASE_URL:-http://localhost:8080}"
AUTH=()
if [ -n "${ROUTER_API_KEY:-}" ]; then
  AUTH=(-H "Authorization: Bearer ${ROUTER_API_KEY}")
fi

echo "== GET /healthz =="
curl -s "${BASE}/healthz"
echo
echo
echo "== POST /routes:select =="
curl -s -X POST "${BASE}/routes:select" \
  -H "Content-Type: application/json" \
  "${AUTH[@]}" \
  --data @examples/request.json
echo
