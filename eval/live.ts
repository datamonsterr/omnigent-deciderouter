// Live golden evaluation: every golden case goes through the real server
// handler with a single decider model (no chat or heuristic rescue hidden in
// the numbers). Run eval/probe.sh first. Results are written without secrets.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "../src/config";
import { createHandler } from "../src/index";
import { rankDecisionsAnswer } from "../src/openrouter";
import { loadApiKey } from "./env";
import {
  goldenRequest,
  LIVE_RESULTS_PATH,
  loadGolden,
  percentile,
  scoreSelection,
  summarize,
  type LiveCaseResult,
} from "./golden";

const FREE_MODEL = "inception/mercury-decide:free";
const deciderModel = process.env.EVAL_DECIDER_MODEL || FREE_MODEL;
const intervalMs = Number.parseInt(process.env.EVAL_INTERVAL_MS || "3100", 10);
const maxCases = Number.parseInt(process.env.EVAL_MAX_CASES || "50", 10);
const outputPath = process.env.EVAL_OUTPUT || LIVE_RESULTS_PATH;
const ACCURACY_GATE = 0.8;
const P95_GATE_MS = 3000;

if (!deciderModel.endsWith(":free") && process.env.EVAL_ALLOW_PAID !== "1") {
  console.error(`Refusing paid decider ${deciderModel}; set EVAL_ALLOW_PAID=1 and report the cost.`);
  process.exit(2);
}
const apiKey = loadApiKey();
if (!apiKey) {
  console.error("Set OPENROUTER_API_KEY or OPENROUTER_ENV_FILE.");
  process.exit(2);
}

const golden = loadGolden();
const cases = golden.cases.slice(0, maxCases);
const config = loadConfig({ ...process.env, OPENROUTER_API_KEY: apiKey, DECIDER_MODELS: deciderModel });

let lastUpstream: { status: number; body: unknown } | null = null;
const recordingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await fetch(input, init);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep raw text
  }
  lastUpstream = { status: res.status, body };
  return new Response(text, { status: res.status, headers: res.headers });
}) as typeof fetch;
const handler = createHandler({ config, fetchFn: recordingFetch });

const results: LiveCaseResult[] = [];
for (const [index, testCase] of cases.entries()) {
  if (index > 0) await Bun.sleep(intervalMs);
  lastUpstream = null;
  const request = goldenRequest(golden, testCase);
  const started = performance.now();
  const res = await handler(
    new Request("http://localhost/routes:select", { method: "POST", body: JSON.stringify(request) }),
  );
  const latencyMs = Math.round(performance.now() - started);
  const body = (await res.json()) as {
    route_selection?: { route_option: { model: string; harness?: string }; params?: Record<string, string> }[];
  };
  const first = body.route_selection?.[0];
  const upstream = lastUpstream as { status: number; body: unknown } | null;
  const result: LiveCaseResult = {
    ...scoreSelection(testCase, request, first?.route_option),
    upstream_status: upstream?.status ?? null,
    latency_ms: latencyMs,
    source: first?.params?.source ?? `router HTTP ${res.status}`,
    decider_model: first?.params?.decider_model ?? deciderModel,
    served_model: first?.params?.served_model,
  };
  if (result.source === "decisions_api") {
    result.upstream_answer = upstream?.body;
  } else if (upstream) {
    // Explain why the decider did not answer instead of hiding it behind the fallback.
    try {
      const answer = (upstream.body as { answers?: { route_decision?: unknown } }).answers?.route_decision;
      rankDecisionsAnswer(answer, request.route_options.length);
      result.error = `upstream HTTP ${upstream.status}`;
    } catch (error) {
      result.error = `upstream HTTP ${upstream.status}: ${(error as Error).message}`;
    }
  } else {
    result.error = "no upstream call (timeout budget or missing key)";
  }
  results.push(result);
  const mark = result.correct ? "ok " : result.forbidden ? "FORBIDDEN" : "miss";
  console.log(
    `${mark} ${testCase.id} -> ${result.selected?.harness}:${result.selected?.model} ` +
      `upstream=${result.upstream_status} ${latencyMs}ms source=${result.source}${result.error ? ` error=${result.error}` : ""}`,
  );
}

const latencies = results.map((r) => r.latency_ms);
const base = summarize(results);
const summary = {
  ...base,
  accuracy: Number(base.accuracy.toFixed(4)),
  unoffered: base.invalid,
  upstream_http_200: results.filter((r) => r.upstream_status === 200).length,
  upstream_errors: results.filter((r) => r.upstream_status !== 200).length,
  fallbacks: results.filter((r) => r.source !== "decisions_api").length,
  sources: Object.fromEntries(
    [...new Set(results.map((r) => r.source))].map((s) => [s, results.filter((r) => r.source === s).length]),
  ),
  served_models: [...new Set(results.map((r) => r.served_model).filter(Boolean))],
  latency_ms: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), max: Math.max(...latencies) },
  gates: {
    all_http_200: results.every((r) => r.upstream_status === 200),
    zero_invalid: base.invalid === 0,
    zero_fallbacks: results.every((r) => r.source === "decisions_api"),
    accuracy_at_least_0_8: base.accuracy >= ACCURACY_GATE,
    p95_under_3000ms: percentile(latencies, 95) < P95_GATE_MS,
  },
};
const passed = Object.values(summary.gates).every(Boolean);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      decider_model: deciderModel,
      command: "OPENROUTER_ENV_FILE=<path> bun run eval:live",
      summary: { ...summary, passed },
      cases: results,
    },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify({ ...summary, passed }, null, 2));
console.log(`results written to ${outputPath}`);
process.exit(passed ? 0 : 1);
