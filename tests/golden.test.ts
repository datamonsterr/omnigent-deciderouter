import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { goldenRequest, loadGolden, LIVE_RESULTS_PATH, loadLiveResults, scoreSelection, summarize } from "../eval/golden";
import { loadConfig } from "../src/config";
import { createHandler } from "../src/index";
import { rankHeuristically } from "../src/heuristic";
import type { FetchFn } from "../src/openrouter";

const golden = loadGolden();
const AUTHORIZED_CODEX_MODELS = ["gpt-6-luna", "gpt-6.1-sol"];
const DISABLED_MODELS = ["claude-sonnet-4-6"];

describe("golden set", () => {
  it("has 30-50 reviewed cases with unique ids", () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(30);
    expect(golden.cases.length).toBeLessThanOrEqual(50);
    expect(new Set(golden.cases.map((c) => c.id)).size).toBe(golden.cases.length);
  });

  it("only offers policy-authorized Polly worker routes", () => {
    for (const option of Object.values(golden.options)) {
      expect(["codex", "agy", "opencode"]).toContain(option.harness ?? "");
      if (option.harness === "codex") expect(AUTHORIZED_CODEX_MODELS).toContain(option.model);
      expect(DISABLED_MODELS).not.toContain(option.model);
    }
  });

  it("keeps acceptable and forbidden outputs inside the offered options and disjoint", () => {
    for (const testCase of golden.cases) {
      const offered = golden.option_sets[testCase.option_set]!.map((o) => `${o.harness}:${o.model}`);
      const acceptable = testCase.acceptable.map((o) => `${o.harness}:${o.model}`);
      const forbidden = testCase.forbidden.map((o) => `${o.harness}:${o.model}`);
      expect(acceptable.length).toBeGreaterThan(0);
      for (const key of [...acceptable, ...forbidden]) expect(offered).toContain(key);
      expect(acceptable.filter((key) => forbidden.includes(key))).toEqual([]);
    }
  });
});

describe("offline golden replay: heuristic fallback", () => {
  const scored = golden.cases.map((testCase) => {
    const request = goldenRequest(golden, testCase);
    const { ranking } = rankHeuristically(request);
    return scoreSelection(testCase, request, request.route_options[ranking[0]!]!);
  });
  const summary = summarize(scored);

  it("never selects an unoffered option", () => {
    expect(summary.invalid).toBe(0);
  });

  it("reaches the 80% top-1 accuracy gate", () => {
    expect(summary.accuracy).toBeGreaterThanOrEqual(0.8);
  });

  it("never picks a forbidden option", () => {
    expect(scored.filter((s) => s.forbidden).map((s) => s.id)).toEqual([]);
  });
});

describe("offline golden replay: recorded live decisions", () => {
  it("has a recorded live run", () => {
    expect(existsSync(LIVE_RESULTS_PATH)).toBe(true);
  });

  it("replays every recorded decisions answer through the server to the same offered selection", async () => {
    const live = loadLiveResults();
    const config = loadConfig({
      OPENROUTER_BASE_URL: "https://mock.openrouter.test",
      OPENROUTER_API_KEY: "test-key",
      DECIDER_MODELS: live.decider_model,
    });
    for (const result of live.cases.filter((c) => c.upstream_answer)) {
      const testCase = golden.cases.find((c) => c.id === result.id)!;
      const fetchFn = (async () =>
        new Response(JSON.stringify(result.upstream_answer), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })) as unknown as FetchFn;
      const handler = createHandler({ config, fetchFn });
      const response = await handler(
        new Request("http://localhost/routes:select", {
          method: "POST",
          body: JSON.stringify(goldenRequest(golden, testCase)),
        }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.route_selection[0].route_option).toEqual(result.selected);
      expect(body.route_selection[0].params.source).toBe("decisions_api");
    }
  });
});
