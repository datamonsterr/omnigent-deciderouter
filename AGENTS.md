# Agent instructions: omnigent-deciderouter

External Smart Routing server for Omnigent (`POST /routes:select`, API
`omnigent.api.routing.v1`). It ranks the route options Omnigent offers by
calling an OpenRouter decision model, with a cheap chat model and a local
heuristic as fallbacks. TypeScript on Bun, no runtime dependencies.

## Layout

- `src/index.ts` — `Bun.serve` handler, request validation, auth.
- `src/decide.ts` — decider chain with time budget and heuristic fallback.
- `src/openrouter.ts` — Decisions API and Chat Completions transports,
  decision-model detection, response validation.
- `src/catalog.ts` — profiles for the Polly worker catalog (criteria text and
  tiers). `src/heuristic.ts` — deterministic fallback ranking.
- `tests/` — `bun test` suites; `tests/golden/routing-golden.json` is the
  reviewed golden routing set.
- `eval/` — live tooling: `check-models.ts`, `probe.sh`, `live.ts`, recorded
  results in `eval/results/`.
- `deploy/` — `systemd --user` unit and install, rollback and Polly
  activation steps.

## Commands

```sh
bun install --frozen-lockfile   # dev deps: typescript, @types/bun (bun.lock)
bun run typecheck               # tsc --noEmit
bun test                        # unit tests + offline golden replay (no network)
bun run build                   # bun build to dist/
bun run check                   # all three
bun run check:models            # decider models exist in the live OpenRouter catalog
OPENROUTER_ENV_FILE=<file> ./eval/probe.sh        # ONE free Decisions API call
OPENROUTER_ENV_FILE=<file> bun run eval:live      # golden eval, free mercury only
docker build -t omnigent-deciderouter .
```

Run the probe before the live eval. The live eval refuses non-`:free`
deciders unless `EVAL_ALLOW_PAID=1`; report any paid run and its cost.

## Rules

- Never print, log or commit an API key. Live scripts read
  `OPENROUTER_API_KEY` or the file named by `OPENROUTER_ENV_FILE`.
- Only options copied from the request may be returned. Keep the
  "not offered" checks in `rankDecisionsAnswer` and `sanitizeRanking`.
- Decision models (`output_modalities` contains `decisions`) speak only the
  Decisions API. Check new model ids with `bun run check:models`; ids the name
  rules in `isDecisionModel` miss go in `DECISIONS_MODELS`.
- The golden set offers only policy-authorized Polly routes. Codex is limited
  to `gpt-6-luna` and `gpt-6.1-sol` (effort low/high lives in
  `policy_routes`, not in route options); `agy-sonnet-thinking` is disabled.
  Do not add models to it without the operator's policy.
- Do not loosen gates to get green: live acceptance is HTTP 200 for every
  case, all 40 unique golden IDs, zero invalid/unoffered/forbidden selections, top-1 accuracy >= 80%, p95 <
  3000 ms, and every fallback reported.
- Tests: TDD with `bun:test`; mock `fetch` through the `fetchFn` dependency,
  never the network.
- Commits follow Conventional Commits. Open PRs against `main`; never push to
  or merge `main` directly.
- CI runs on `namespace-profile-datamonster01` with pinned action SHAs and
  read-only permissions. The live job runs only on manual `workflow_dispatch` (PR registration skips
  the job before secret access) and is the only place the `OPENROUTER_API_KEY` secret is used.
- Do not activate the Omnigent integration or restart `omni-agent.service`
  without the operator; see `deploy/README.md`.

## Skills

- Project skill bank (private, routed by the Jev skill selector):
  `.agents/jev_skills/`, installed from pinned commits with
  `bun run skills:install` (manifest: `.agents/skills-manifest.json`). It holds
  `openrouter-decisions`, `openrouter-models`, `bun-test-basics`,
  `bun-test-mocking` and `github-actions-templates`.
- The selector itself is discoverable at `.agents/skills/jev-skill-selector/`.
  For harnesses without a prompt hook, run
  `SKILL_SELECTOR_EXCLUSIVE=1 SKILL_SELECTOR_AGENT_SKILLS_PATH=$PWD/.agents/jev_skills .agents/skills/jev-skill-selector/run.sh "<task>" --content`.
  Prompt hooks are installed globally; do not add project hooks.
