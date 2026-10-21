// Golden routing set: loading, request building and scoring shared by the
// offline replay tests and the live evaluation script.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RouteOption, SelectRouteRequest } from "../src/types";

export const GOLDEN_PATH = join(import.meta.dir, "..", "tests", "golden", "routing-golden.json");
export const LIVE_RESULTS_PATH = join(import.meta.dir, "results", "live-golden.json");
export const ROUTER_NAME = "deciderouter_v1";

export interface GoldenCase {
  id: string;
  complexity: string;
  option_set: string;
  prompt: string;
  acceptable: RouteOption[];
  forbidden: RouteOption[];
  policy_routes: string[];
}

export interface GoldenSet {
  version: number;
  options: Record<string, RouteOption>;
  option_sets: Record<string, RouteOption[]>;
  cases: GoldenCase[];
}

export interface ScoredCase {
  id: string;
  selected: RouteOption | null;
  offered: boolean;
  correct: boolean;
  forbidden: boolean;
}

export interface LiveCaseResult extends ScoredCase {
  upstream_status: number | null;
  router_status: number;
  latency_ms: number;
  source: string;
  decider_model: string;
  served_model?: string;
  error?: string;
  /** Raw Decisions API body, kept so the offline replay can re-run it. */
  upstream_answer?: unknown;
}

export interface LiveResults {
  generated_at: string;
  decider_model: string;
  command: string;
  summary: Record<string, unknown>;
  cases: LiveCaseResult[];
}

export function loadGolden(path = GOLDEN_PATH): GoldenSet {
  return JSON.parse(readFileSync(path, "utf8")) as GoldenSet;
}

export function loadLiveResults(path = LIVE_RESULTS_PATH): LiveResults {
  return JSON.parse(readFileSync(path, "utf8")) as LiveResults;
}

export function goldenRequest(golden: GoldenSet, testCase: GoldenCase): SelectRouteRequest {
  const options = golden.option_sets[testCase.option_set];
  if (!options) throw new Error(`Unknown option_set ${testCase.option_set} in case ${testCase.id}`);
  return {
    route_options: options.map((o) => ({ ...o })),
    task: { prompt: testCase.prompt },
    route_selector: { router_name: ROUTER_NAME },
  };
}

function sameOption(a: RouteOption, b: RouteOption): boolean {
  return a.model === b.model && (a.harness ?? "") === (b.harness ?? "");
}

export function scoreSelection(
  testCase: GoldenCase,
  request: SelectRouteRequest,
  selected: RouteOption | null | undefined,
): ScoredCase {
  const pick = selected ?? null;
  const offered = pick !== null && request.route_options.some((o) => sameOption(o, pick));
  return {
    id: testCase.id,
    selected: pick,
    offered,
    correct: offered && testCase.acceptable.some((o) => sameOption(o, pick!)),
    forbidden: offered && testCase.forbidden.some((o) => sameOption(o, pick!)),
  };
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]!;
}

export function summarize(scored: ScoredCase[]) {
  const total = scored.length;
  const correct = scored.filter((s) => s.correct).length;
  return {
    total,
    correct,
    invalid: scored.filter((s) => !s.offered).length,
    forbidden: scored.filter((s) => s.forbidden).length,
    accuracy: total ? correct / total : 0,
  };
}

/** Smoke results are diagnostic only; acceptance always evaluates the entire set. */
export function evaluationPlan(env: Record<string, string | undefined>, total: number) {
  const mode = env.EVAL_MODE ?? "acceptance";
  if (mode !== "acceptance" && mode !== "smoke") throw new Error("EVAL_MODE must be acceptance or smoke");
  const raw = env.EVAL_MAX_CASES ?? String(total);
  const count = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(count) || count > total) {
    throw new Error("EVAL_MAX_CASES must be a positive integer within the golden set");
  }
  if (mode === "acceptance" && count !== total) throw new Error("Acceptance requires every golden case; use EVAL_MODE=smoke");
  return { mode, count };
}

export function acceptanceSummary(golden: GoldenSet, results: LiveCaseResult[]) {
  const expected = new Set(golden.cases.map((c) => c.id));
  const ids = new Set(results.map((r) => r.id));
  const complete = expected.size === golden.cases.length && results.length === expected.size &&
    ids.size === expected.size && [...ids].every((id) => expected.has(id));
  const scored = results.map((result) => {
    const testCase = golden.cases.find((c) => c.id === result.id);
    return testCase ? scoreSelection(testCase, goldenRequest(golden, testCase), result.selected) :
      { id: result.id, selected: null, correct: false, offered: false, forbidden: false };
  });
  const base = summarize(scored);
  const latencies = results.map((r) => r.latency_ms);
  const gates = {
    complete_golden: complete,
    all_http_200: results.every((r) => r.upstream_status === 200 && r.router_status === 200),
    zero_invalid: base.invalid === 0,
    zero_forbidden: base.forbidden === 0,
    zero_fallbacks: results.every((r) => r.source === "decisions_api"),
    accuracy_at_least_0_8: base.accuracy >= 0.8,
    p95_under_3000ms: latencies.every((n) => Number.isFinite(n) && n >= 0) && percentile(latencies, 95) < 3000,
  };
  return {
    ...base,
    unoffered: base.invalid,
    upstream_http_200: results.filter((r) => r.upstream_status === 200).length,
    upstream_errors: results.filter((r) => r.upstream_status !== 200).length,
    fallbacks: results.filter((r) => r.source !== "decisions_api").length,
    sources: Object.fromEntries([...new Set(results.map((r) => r.source))].map((s) => [s, results.filter((r) => r.source === s).length])),
    served_models: [...new Set(results.map((r) => r.served_model).filter(Boolean))],
    latency_ms: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), max: latencies.length ? Math.max(...latencies) : 0 },
    gates,
    passed: Object.values(gates).every(Boolean),
  };
}
