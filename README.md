# omnigent-openrouter-router

A small, self-hostable **external Smart Routing server for [Omnigent](https://github.com/omnigent-ai/omnigent)**.

Omnigent can delegate Smart Routing — deciding which **model + harness** should handle a task — to an external service. This is that service: one TypeScript + Bun server, no npm dependencies, that you run with a single Docker Compose command.

It makes each routing decision with a **decision model via the [OpenRouter](https://openrouter.ai) API, prioritising free models first, then cheap ones**, and falls back to a deterministic local heuristic if no model is available — so routing never hard-fails.

## Quickstart

### With Docker (recommended)

```sh
cp .env.example .env   # optionally add OPENROUTER_API_KEY and ROUTER_API_KEY
docker compose up --build
```

### Without Docker

Requires [Bun](https://bun.sh).

```sh
cp .env.example .env
bun run src/index.ts
```

The server listens on `http://localhost:8080` (configurable with `PORT` / `HOST`). It works **without** an OpenRouter key — in that case every decision comes from the local heuristic.

Check it is up:

```sh
curl http://localhost:8080/healthz
# {"ok":true,"service":"omnigent-openrouter-router","decider_models":["inception/mercury-decide:free","google/gemini-2.5-flash-lite"]}
```

## Connect Omnigent to it

Add this to your Omnigent server config (see also [`examples/omnigent-config.yaml`](examples/omnigent-config.yaml)):

```yaml
routing:
  provider: external
  base_url: http://localhost:8080
  router_name: deciderouter_v1
  api_key: ${ROUTER_API_KEY}
```

Use any `router_name` except `task_v1`: for that name Omnigent injects its built-in task_v1 arm menu (extra model ids) into `route_options`. For this host's local service and the Polly activation steps, see [`deploy/README.md`](deploy/README.md).

If you set `ROUTER_API_KEY` in this server's `.env`, set the same value in Omnigent — it is sent as `Authorization: Bearer <token>` and checked on every routing request. If it is unset here, no auth is required.

## Try it

```sh
curl -s -X POST http://localhost:8080/routes:select \
  -H "Content-Type: application/json" \
  --data @examples/request.json
```

Sample response (produced here by the local heuristic, with no OpenRouter key; truncated to the first three of seven ranked options):

```json
{
  "route_selection": [
    {
      "route_option": { "model": "gpt-6.1-sol", "harness": "codex" },
      "params": { "decider_model": "local-heuristic", "source": "heuristic" }
    },
    { "route_option": { "model": "gemini-3.8-flash-high", "harness": "agy" } },
    { "route_option": { "model": "opencode-go/muse-spark-1.3-contributor", "harness": "opencode" } }
  ],
  "rationale": "Heuristic fallback (no decider model available): task looks complex, so gpt-6.1-sol via codex was ranked first as the most capable offered option."
}
```

See [`examples/curl.sh`](examples/curl.sh) for a ready-made smoke test.

## How routing works

For each request the server **ranks all offered route options, best first** (Omnigent uses the first entry). It tries a chain of decider models in order, and the first one that answers usefully wins:

1. **`inception/mercury-decide:free`** — a *free* decision model, called through OpenRouter's **Decisions API** (`POST /api/alpha/decisions`). The task and options are sent as `state` + a `route_decision` choice question with one criterion per option; options are ranked by the returned probabilities.
2. **`google/gemini-2.5-flash-lite`** — a *cheap* chat model, called through OpenRouter **Chat Completions**. It is instructed to reply with only `{"ranking":[...],"rationale":"..."}`.
3. **Local heuristic** — deterministic, no network: it infers a capability tier from each model name (e.g. opus / gpt-5 / 70b / sonnet = high; mini / flash / lite / haiku = fast & cheap) and estimates task complexity from the prompt (length + keywords like *refactor, architecture, migrate* vs *typo, rename, format*). Complex tasks get the most capable option first; simple tasks get the fastest/cheapest first.

Rules that keep this predictable:

- **Free → cheap priority** everywhere, and the whole chain is configurable via `DECIDER_MODELS` (or per-request via `route_selector.config.decider_models`).
- Decision models use the Decisions API: TypeSafe Jev ids (`~typesafe/jev-latest`, `typesafe/jev-1.14`), ids with a `decide` / `decider` / `decision(s)` name segment (`inception/mercury-decide:free`, `perplexity/pplx-decider-flash-v1.2`, `openai/gpt-6-luna-decisions`), and ids listed in `DECISIONS_MODELS`. All other models use Chat Completions. `bun run check:models` checks the configured chain against the live catalog (`/api/v1/models?output_modalities=decisions`).
- Decisions answers are validated: the answer must be a `choice`, the chosen key must be an offered option, supplied confidence and probabilities must be finite numbers in [0,1], probability keys must be offered, and the choice must share the highest supplied probability (ties are valid). Confidence and probabilities may be omitted per the official schema. Anything else counts as a failure and moves to the next model.
- Each option is described to the decision model with its known profile (for the Polly worker catalog: `gpt-6-luna`, `gpt-6.1-sol`, `gemini-3.8-flash-low|medium|high`, `opencode/deepseek-v4.1-flash-free`, `opencode-go/muse-spark-1.3-contributor`), so the model judges capability and cost, not just names.
- Each attempt has a timeout and the whole decision has an overall budget (`ROUTER_TIMEOUT_MS`, default 8000 ms). A failure, `429`/`5xx`, or unparseable output simply moves to the next model.
- **Only options copied verbatim from the request are ever returned** — a selection that was not offered is invalid in Omnigent, so this server never invents one.
- The winning decider is recorded in the first selection's `params`: `decider_model`, `source` (`decisions_api` | `chat` | `heuristic`) and, for decision models, `served_model` (the dated build). Bounded `attempt_errors` reports up to eight failed attempts with transport and fixed validation/HTTP errors; arbitrary exception text and upstream error bodies are never forwarded.

## API contract

Implements `omnigent.api.routing.v1` (proto3 as JSON, snake_case):

| Endpoint | Description |
| --- | --- |
| `POST /routes:select` | Body: `SelectRouteRequest` — `route_options` (non-empty), `task.prompt`, `route_selector.router_name` (required), optional `session_history`. Returns: `SelectRouteResponse` — `route_selection` (all options, ranked) + `rationale`. |
| `GET /healthz` | `200 {"ok":true,"service":"omnigent-openrouter-router","decider_models":[...]}` |

Errors are JSON: malformed JSON, a missing `route_selector`, or empty `route_options` → `400`; a wrong/missing Bearer token when `ROUTER_API_KEY` is set → `401`; unknown paths → `404`.

References:

- Routing API: <https://omnigent.ai/docs/reference/routing-api>
- Smart Routing configuration: <https://omnigent.ai/docs/reference/configuration/routing>

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | — | OpenRouter key for the decider models. Optional: without it, the heuristic answers everything. |
| `DECIDER_MODELS` | `inception/mercury-decide:free,google/gemini-2.5-flash-lite` | Decider chain, tried in order (free first, then cheap). |
| `DECISIONS_MODELS` | — | Extra decision-model ids (exact) whose names are not recognized, e.g. `liquid/d1`. |
| `ROUTER_API_KEY` | — | If set, `POST /routes:select` requires a matching Bearer token. |
| `ROUTER_TIMEOUT_MS` | `8000` | Overall decision budget in milliseconds. |
| `PORT` | `8080` | Listen port. |
| `HOST` | `0.0.0.0` | Listen host. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai` | Base URL used to build both OpenRouter endpoints (mainly for tests). |
| `OPENROUTER_DECISIONS_URL` | `<base>/api/alpha/decisions` | Full override for the Decisions API endpoint. |

## Project layout

```
src/
  index.ts       Bun.serve server, request validation, auth
  decide.ts      Decider-chain orchestration with timeouts + fallback
  openrouter.ts  Both OpenRouter transports, decision-model detection, answer validation
  catalog.ts     Polly worker catalog profiles (criteria text, tiers)
  heuristic.ts   Deterministic local fallback ranking
  config.ts      Environment configuration
  types.ts       omnigent.api.routing.v1 types
tests/           bun test suites (mock fetch, no network)
  golden/routing-golden.json   40 reviewed golden routing cases
eval/
  check-models.ts  live catalog check for the decider chain
  probe.sh         one free Decisions API call with curl
  live.ts          live golden evaluation
  results/         recorded, secret-free live results
deploy/          systemd --user unit, install / rollback / Polly activation
examples/        Omnigent routing: block, sample request, curl smoke test
Dockerfile, docker-compose.yml
```

## Development

```sh
bun install --frozen-lockfile
bun run check          # typecheck + tests (incl. offline golden replay) + build
bun --watch run src/index.ts   # dev server with reload (bun run dev)
```

## Golden set and live evaluation

`tests/golden/routing-golden.json` holds 40 reviewed routing cases for Polly's
workers (codex, agy, opencode): task complexity, the offered option set, the
acceptable and forbidden selections, and the operator policy route ids. Codex
options are limited to `gpt-6-luna` and `gpt-6.1-sol`; their low/high effort is
recorded in `policy_routes` because a RouteOption has no effort field.

- **Offline** (`bun test`): validates the set, replays it through the local
  heuristic (gate: 0 unoffered, >= 80% top-1, 0 forbidden) and replays the
  recorded live Decisions answers in `eval/results/live-golden.json` through the
  server and re-scores current labels with the complete unique ID set required.
- **Live** (probe first, then eval; free `inception/mercury-decide:free` only,
  one call per case, 3.1 s apart):

  ```sh
  OPENROUTER_ENV_FILE=~/.config/omnigent-deciderouter/openrouter.env ./eval/probe.sh
  OPENROUTER_ENV_FILE=~/.config/omnigent-deciderouter/openrouter.env bun run eval:live
  ```

  Gates: all 40 unique golden IDs, router and upstream HTTP 200 for every case, 0 invalid/unoffered/forbidden selections, 0
  fallbacks, top-1 accuracy >= 80%, p95 < 3000 ms. Results (no secrets) are
  written to `eval/results/live-golden.json`.

  `bun run eval:smoke` explicitly selects smoke mode with one case; it always
  records `passed: false` and cannot satisfy deployment acceptance.
  `EVAL_MAX_CASES` must be a positive integer within the set; acceptance mode
  rejects any count smaller than the complete set.

## CI

`.github/workflows/ci.yml` runs on the Namespace runner profile
`namespace-profile-datamonster01` for pushes to `main`, same-repo pull requests
and manual runs: frozen install, typecheck, tests with the offline golden
replay, build, and a Docker build plus container smoke test. Actions are pinned
by commit SHA, permissions are read-only, and runs are bounded by concurrency
groups and timeouts. Pull requests from forks are skipped so they never run on
this account's runners. Dependency caching is off: two dev dependencies install
in about a second.

`.github/workflows/live-eval.yml` is manual (`workflow_dispatch`) and the only
workflow that reads the `OPENROUTER_API_KEY` secret: catalog check, probe, then
the live golden eval, with results uploaded as an artifact.

## Deploying locally

See [`deploy/README.md`](deploy/README.md) for the `systemd --user` service,
updates, rollback and the (separate, manual) Polly integration steps.

## Background

The design is informed by the author's earlier Python reference implementation, **agent-dispatcher** (its `jev_router`), but this project is a clean, standalone, **model-agnostic** implementation — decoupled from Jev/TypeSafe and from any single decision model. Any OpenRouter model can be put in the decider chain.

## License

MIT — see [LICENSE](LICENSE). Copyright 2026 Pham Thanh Dat.
