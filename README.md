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
# {"ok":true,"service":"omnigent-openrouter-router","decider_models":["inception/mercury-decide:free","meta-llama/llama-3.3-70b-instruct:free","google/gemini-2.5-flash-lite"]}
```

## Connect Omnigent to it

Add this to your Omnigent server config (see also [`examples/omnigent-config.yaml`](examples/omnigent-config.yaml)):

```yaml
routing:
  provider: external
  base_url: http://localhost:8080
  router_name: task_v0
  api_key: ${ROUTER_API_KEY}
```

If you set `ROUTER_API_KEY` in this server's `.env`, set the same value in Omnigent — it is sent as `Authorization: Bearer <token>` and checked on every routing request. If it is unset here, no auth is required.

## Try it

```sh
curl -s -X POST http://localhost:8080/routes:select \
  -H "Content-Type: application/json" \
  --data @examples/request.json
```

Sample response (produced here by the local heuristic, with no OpenRouter key):

```json
{
  "route_selection": [
    {
      "route_option": { "model": "anthropic/claude-opus-4", "harness": "claude-code" },
      "params": { "decider_model": "local-heuristic", "source": "heuristic" }
    },
    { "route_option": { "model": "openai/gpt-5-mini", "harness": "codex" } },
    { "route_option": { "model": "google/gemini-2.5-flash-lite", "harness": "opencode" } }
  ],
  "rationale": "Heuristic fallback (no decider model available): task looks complex, so anthropic/claude-opus-4 via claude-code was ranked first as the most capable offered option."
}
```

See [`examples/curl.sh`](examples/curl.sh) for a ready-made smoke test.

## How routing works

For each request the server **ranks all offered route options, best first** (Omnigent uses the first entry). It tries a chain of decider models in order, and the first one that answers usefully wins:

1. **`inception/mercury-decide:free`** — a *free* decision model, called through OpenRouter's **Decisions API** (`POST /api/alpha/decisions`). The task and options are sent as `state` + a `route_decision` choice question with one criterion per option; options are ranked by the returned probabilities.
2. **`meta-llama/llama-3.3-70b-instruct:free`** — a *free* general model, called through OpenRouter **Chat Completions**. It is instructed to reply with only `{"ranking":[...],"rationale":"..."}`.
3. **`google/gemini-2.5-flash-lite`** — a *cheap* chat model, same chat path.
4. **Local heuristic** — deterministic, no network: it infers a capability tier from each model name (e.g. opus / gpt-5 / 70b / sonnet = high; mini / flash / lite / haiku = fast & cheap) and estimates task complexity from the prompt (length + keywords like *refactor, architecture, migrate* vs *typo, rename, format*). Complex tasks get the most capable option first; simple tasks get the fastest/cheapest first.

Rules that keep this predictable:

- **Free → cheap priority** everywhere, and the whole chain is configurable via `DECIDER_MODELS` (or per-request via `route_selector.config.decider_models`).
- A model whose id contains `decide`, or that is listed in `DECISIONS_MODELS`, uses the Decisions API; all other models use Chat Completions.
- Each attempt has a timeout and the whole decision has an overall budget (`ROUTER_TIMEOUT_MS`, default 8000 ms). A failure, `429`/`5xx`, or unparseable output simply moves to the next model.
- **Only options copied verbatim from the request are ever returned** — a selection that was not offered is invalid in Omnigent, so this server never invents one.
- The winning decider is recorded in the first selection's `params`: `decider_model` and `source` (`decisions_api` | `chat` | `heuristic`).

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
| `DECIDER_MODELS` | `inception/mercury-decide:free,meta-llama/llama-3.3-70b-instruct:free,google/gemini-2.5-flash-lite` | Decider chain, tried in order (free first, then cheap). |
| `DECISIONS_MODELS` | — | Extra model ids (exact) that must use the Decisions API. |
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
  openrouter.ts  Both OpenRouter transports (Decisions API, Chat Completions)
  heuristic.ts   Deterministic local fallback ranking
  config.ts      Environment configuration
  types.ts       omnigent.api.routing.v1 types
tests/
  router.test.ts bun test suite (mock fetch, no network needed)
examples/
  omnigent-config.yaml  routing: block for your Omnigent config
  request.json          sample SelectRouteRequest
  curl.sh               healthz + routes:select smoke test
Dockerfile, docker-compose.yml
```

## Development

```sh
bun test               # run the test suite
bun --watch run src/index.ts   # dev server with reload (bun run dev)
```

## Background

The design is informed by the author's earlier Python reference implementation, **agent-dispatcher** (its `jev_router`), but this project is a clean, standalone, **model-agnostic** implementation — decoupled from Jev/TypeSafe and from any single decision model. Any OpenRouter model can be put in the decider chain.

## License

MIT — see [LICENSE](LICENSE). Copyright 2026 Pham Thanh Dat.
