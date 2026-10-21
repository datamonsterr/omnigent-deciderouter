// Types for Omnigent's routing API: omnigent.api.routing.v1
// (proto3, sent/received as JSON with snake_case field names).
// See https://omnigent.ai/docs/reference/routing-api

export interface RouteOption {
  model: string;
  harness?: string;
}

export interface RoutingTask {
  /** Server-side prompt, truncated to 4000 chars by Omnigent. */
  prompt: string;
}

export interface RouteSelector {
  router_name: string;
  /** Free-form per-router config. We honour `decider_models?: string[]`. */
  config?: Record<string, unknown>;
}

export interface SelectRouteRequest {
  route_options: RouteOption[];
  task: RoutingTask;
  route_selector: RouteSelector;
  /** Optional conversation history. Accepted, used lightly, shape-tolerant. */
  session_history?: unknown;
}

export interface RouteSelection {
  route_option: RouteOption;
  params?: Record<string, unknown>;
}

export interface SelectRouteResponse {
  /** ALL offered options, ranked best-first. Omnigent uses the first entry. */
  route_selection: RouteSelection[];
  rationale: string;
}

export type DecisionSource = "decisions_api" | "chat" | "heuristic";

export interface AttemptError {
  attempt: number;
  source: "decisions_api" | "chat";
  error: string;
}

export interface DecisionResult {
  attemptErrors: AttemptError[];
  /** Indices into route_options, best-first, every index exactly once. */
  ranking: number[];
  rationale: string;
  /** The decision model used, or "local-heuristic" for the fallback. */
  deciderModel: string;
  /** Dated build reported by the Decisions API, when available. */
  servedModel?: string;
  source: DecisionSource;
}
