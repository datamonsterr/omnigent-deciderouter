import type { Config } from "./config";
import { loadConfig } from "./config";
import { decideRoute } from "./decide";
import type { FetchFn } from "./openrouter";
import type { RouteOption, SelectRouteRequest, SelectRouteResponse } from "./types";

export interface HandlerDeps {
  config?: Config;
  fetchFn?: FetchFn;
}

const SERVICE = "omnigent-openrouter-router";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateRequest(body: unknown): { req?: SelectRouteRequest; error?: string } {
  if (!isRecord(body)) return { error: "Request body must be a JSON object" };
  if (!isRecord(body.route_selector) || typeof body.route_selector.router_name !== "string" || !body.route_selector.router_name) {
    return { error: "Missing route_selector: a SelectRouteRequest must include route_selector.router_name" };
  }
  if (!Array.isArray(body.route_options) || body.route_options.length === 0) {
    return { error: "route_options must be a non-empty array" };
  }
  for (const option of body.route_options) {
    if (!isRecord(option) || typeof option.model !== "string" || !option.model) {
      return { error: "Every route_option must have a non-empty model string" };
    }
    if (option.harness !== undefined && typeof option.harness !== "string") {
      return { error: "route_option.harness must be a string when present" };
    }
  }
  if (!isRecord(body.task) || typeof body.task.prompt !== "string") {
    return { error: "task.prompt must be a string" };
  }
  return { req: body as unknown as SelectRouteRequest };
}

function copyOption(option: RouteOption): RouteOption {
  // Copy verbatim: a selection that was not offered is invalid.
  return option.harness !== undefined
    ? { model: option.model, harness: option.harness }
    : { model: option.model };
}

export function createHandler(deps: HandlerDeps = {}) {
  const config = deps.config ?? loadConfig();
  const fetchFn = deps.fetchFn ?? fetch;

  return async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/healthz") {
      if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
      return json({ ok: true, service: SERVICE, decider_models: config.deciderModels });
    }

    if (url.pathname !== "/routes:select") {
      return json({ error: "Not found" }, 404);
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    if (config.routerApiKey) {
      if (req.headers.get("authorization") !== `Bearer ${config.routerApiKey}`) {
        return json({ error: "Unauthorized" }, 401);
      }
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Malformed JSON body" }, 400);
    }

    const { req: selectReq, error } = validateRequest(body);
    if (!selectReq) return json({ error }, 400);

    const decision = await decideRoute(selectReq, config, fetchFn);

    const response: SelectRouteResponse = {
      route_selection: decision.ranking.map((index, position) => {
        const selection: SelectRouteResponse["route_selection"][number] = {
          route_option: copyOption(selectReq.route_options[index]!),
        };
        if (position === 0) {
          selection.params = { decider_model: decision.deciderModel, source: decision.source };
        }
        return selection;
      }),
      rationale: decision.rationale,
    };
    return json(response);
  };
}

/** Default handler using environment config — convenient for tests/tools. */
export const handleRequest = createHandler();

if (import.meta.main) {
  const config = loadConfig();
  Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: createHandler({ config }),
  });
  console.log(`${SERVICE} listening on http://${config.host}:${config.port}`);
}
