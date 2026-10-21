import type { Config } from "./config";
import { rankHeuristically } from "./heuristic";
import { askChatModel, askDecisionsModel, isDecisionModel, sanitizeRanking, type FetchFn } from "./openrouter";
import type { DecisionResult, SelectRouteRequest } from "./types";

/** Per-request override: route_selector.config.decider_models (string[]). */
export function deciderChain(req: SelectRouteRequest, config: Config): string[] {
  const override = req.route_selector?.config?.decider_models;
  if (Array.isArray(override) && override.length && override.every((m) => typeof m === "string" && m)) {
    return override as string[];
  }
  return config.deciderModels;
}

/**
 * Try each decider model in order (free first, then cheap) inside the overall
 * time budget. Any failure — timeout, 429/5xx, bad output — moves to the next
 * model. If there is no OpenRouter key, or every model fails, fall back to
 * the deterministic local heuristic.
 */
export async function decideRoute(
  req: SelectRouteRequest,
  config: Config,
  fetchFn: FetchFn = fetch,
): Promise<DecisionResult> {
  if (config.openRouterApiKey) {
    const deadline = Date.now() + config.timeoutMs;
    for (const model of deciderChain(req, config)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        const viaDecisions = isDecisionModel(model, config);
        const answer = viaDecisions
          ? await askDecisionsModel(model, req, config, fetchFn, remaining)
          : await askChatModel(model, req, config, fetchFn, remaining);
        return {
          ranking: sanitizeRanking(answer.ranking, req.route_options.length),
          rationale: answer.rationale,
          deciderModel: model,
          servedModel: answer.servedModel,
          source: viaDecisions ? "decisions_api" : "chat",
        };
      } catch {
        // Try the next model in the chain.
      }
    }
  }

  const { ranking, rationale } = rankHeuristically(req);
  return { ranking, rationale, deciderModel: "local-heuristic", source: "heuristic" };
}
