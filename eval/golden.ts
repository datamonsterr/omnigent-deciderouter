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
