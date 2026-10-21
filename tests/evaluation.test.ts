import { replayRecorded } from "../eval/replay";
import { loadLiveResults } from "../eval/golden";
import { describe, expect, it } from "bun:test";
import { acceptanceSummary, evaluationPlan, goldenRequest, loadGolden, scoreSelection, type LiveCaseResult } from "../eval/golden";

const golden = loadGolden();
function completeResults(): LiveCaseResult[] {
  return golden.cases.map((testCase) => ({
    ...scoreSelection(testCase, goldenRequest(golden, testCase), testCase.acceptable[0]),
    upstream_status: 200, router_status: 200, latency_ms: 100,
    source: "decisions_api", decider_model: "inception/mercury-decide:free",
  }));
}

describe("deployment acceptance", () => {
  it("requires the complete unique golden ID set", () => {
    const all = completeResults();
    expect(acceptanceSummary(golden, all).passed).toBe(true);
    for (const results of [all.slice(0, 1), [], [...all.slice(1), all[1]!], [...all, all[0]!]]) {
      expect(acceptanceSummary(golden, results).passed).toBe(false);
    }
  });

  it("unconditionally rejects one forbidden pick even above the accuracy threshold", () => {
    const all = completeResults();
    const index = golden.cases.findIndex((c) => c.forbidden.length);
    all[index] = { ...all[index]!, selected: golden.cases[index]!.forbidden[0]! };
    const summary = acceptanceSummary(golden, all);
    expect(summary.accuracy).toBeGreaterThan(0.8);
    expect(summary.gates.zero_forbidden).toBe(false);
    expect(summary.passed).toBe(false);
  });

  it("recomputes current labels and ignores saved correctness flags", () => {
    const all = completeResults();
    const relabeled = structuredClone(golden);
    for (const c of relabeled.cases) c.acceptable = [];
    expect(acceptanceSummary(relabeled, all).accuracy).toBe(0);
    expect(acceptanceSummary(relabeled, all).passed).toBe(false);
  });

  it.each(["http", "fallback", "latency", "unoffered"])("rejects %s failures", (fault) => {
    const all = completeResults();
    if (fault === "http") all[0]!.router_status = 500;
    if (fault === "fallback") all[0]!.source = "heuristic";
    if (fault === "latency") for (const r of all) r.latency_ms = 3000;
    if (fault === "unoffered") all[0]!.selected = { model: "unoffered" };
    expect(acceptanceSummary(golden, all).passed).toBe(false);
  });
});

describe("smoke versus acceptance", () => {
  it("defaults acceptance to all cases and allows bounded smoke only explicitly", () => {
    expect(evaluationPlan({}, 40)).toEqual({ mode: "acceptance", count: 40 });
    expect(evaluationPlan({ EVAL_MODE: "smoke", EVAL_MAX_CASES: "1" }, 40)).toEqual({ mode: "smoke", count: 1 });
  });

  it.each(["1", "0", "-1", "NaN", "1.5", "40junk", "41"])("rejects acceptance count %s", (count) => {
    expect(() => evaluationPlan({ EVAL_MAX_CASES: count }, 40)).toThrow();
  });

  it.each(["0", "-1", "1.5", "bad", "41"])("rejects malformed smoke count %s", (count) => {
    expect(() => evaluationPlan({ EVAL_MODE: "smoke", EVAL_MAX_CASES: count }, 40)).toThrow();
  });
});


describe("recorded replay acceptance", () => {
  it("rejects truncated, duplicate and missing raw evidence", async () => {
    const live = loadLiveResults();
    expect((await replayRecorded(golden, { ...live, cases: live.cases.slice(0, 1) })).passed).toBe(false);
    expect((await replayRecorded(golden, { ...live, cases: [...live.cases.slice(1), live.cases[1]!] })).passed).toBe(false);
    const missing = structuredClone(live);
    delete missing.cases[0]!.upstream_answer;
    await expect(replayRecorded(golden, missing)).rejects.toThrow(/raw/);
  });

  it("scores raw answers against current labels instead of saved selections and scores", async () => {
    const live = loadLiveResults();
    for (const r of live.cases) {
      r.selected = { model: "fabricated" };
      r.correct = true;
    }
    expect((await replayRecorded(golden, live)).passed).toBe(true);
    const changed = structuredClone(golden);
    for (const c of changed.cases) c.acceptable = [];
    expect((await replayRecorded(changed, live)).passed).toBe(false);
  });
});

it("the live CLI rejects partial acceptance before credential loading or network access", () => {
  const processResult = Bun.spawnSync(["bun", "run", "eval/live.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, EVAL_MODE: "acceptance", EVAL_MAX_CASES: "1", OPENROUTER_API_KEY: "", OPENROUTER_ENV_FILE: "" },
  });
  expect(processResult.exitCode).not.toBe(0);
  expect(processResult.stderr.toString()).toContain("Acceptance requires every golden case");
});
