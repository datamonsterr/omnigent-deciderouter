#!/usr/bin/env bash
set -euo pipefail

# Execute only the reviewed source tree, never an arbitrary PATH command.
pinned=68cbbeca4e22750c87869578e970b00def6b1450
runtime="${JEV_PATH:-$HOME/dev/jev_skill_selector}"
fail() { echo "selector provenance rejected: $1" >&2; exit 1; }
[ -f "$runtime/index.ts" ] || fail "missing runtime; set JEV_PATH"
head="$(git -C "$runtime" rev-parse HEAD 2>/dev/null)" || fail "not a Git checkout"
[ "$head" = "$pinned" ] || fail "unexpected commit"
origin="$(git -C "$runtime" remote get-url origin 2>/dev/null)" || fail "missing origin"
case "$origin" in
  git@github.com:datamonsterr/jev_auto_select_skills.git|https://github.com/datamonsterr/jev_auto_select_skills.git) ;;
  *) fail "unexpected origin" ;;
esac
[ -z "$(git -C "$runtime" status --porcelain --untracked-files=normal)" ] || fail "dirty source tree"
echo "selector provenance: source=datamonsterr/jev_auto_select_skills commit=$head runtime=$runtime" >&2
if [ "${1:-}" = "--verify-runtime" ]; then exit 0; fi
exec bun run "$runtime/index.ts" "$@"
