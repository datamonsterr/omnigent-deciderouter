#!/usr/bin/env bash
# Minimal safe live probe: ONE free Decisions API call with curl.
# The key is read from $OPENROUTER_API_KEY or from the file named by
# $OPENROUTER_ENV_FILE and is passed to curl on stdin, never in argv or output.
set -euo pipefail
cd "$(dirname "$0")"

key="${OPENROUTER_API_KEY:-}"
if [ -z "$key" ] && [ -n "${OPENROUTER_ENV_FILE:-}" ]; then
  key="$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}OPENROUTER_API_KEY[[:space:]]*=[[:space:]]*//p' "$OPENROUTER_ENV_FILE" | head -n1 | tr -d "\"'")"
fi
if [ -z "$key" ]; then
  echo "probe: set OPENROUTER_API_KEY or OPENROUTER_ENV_FILE" >&2
  exit 2
fi

url="${OPENROUTER_DECISIONS_URL:-https://openrouter.ai/api/alpha/decisions}"
mkdir -p ../.scratch
body="$(mktemp ../.scratch/probe-XXXXXX)"
trap 'rm -f "$body"' EXIT
# printf is a shell builtin, so the header never appears in a process listing.
meta="$(printf 'Authorization: Bearer %s\n' "$key" | curl -sS -o "$body" \
  -w '%{http_code} %{time_total}' -H @- \
  -H 'Content-Type: application/json' \
  -H 'HTTP-Referer: https://github.com/datamonsterr/omnigent-deciderouter' \
  -H 'X-OpenRouter-Title: omnigent-deciderouter' \
  --max-time 20 --data @probe-request.json "$url")"
status="${meta%% *}"
seconds="${meta##* }"
echo "http_status=$status time_total_s=$seconds"
bun -e '
const body = JSON.parse(await Bun.file(process.argv[1]).text());
const answer = body.answers?.route_decision;
console.log(JSON.stringify({ model: body.model, choice: answer?.choice, probabilities: answer?.probabilities, confidence: answer?.confidence, usage: body.usage, error_code: body.error?.code }));
' "$body"
[ "$status" = "200" ]
