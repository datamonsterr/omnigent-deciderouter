import { loadConfig } from "../src/config";
import { createHandler } from "../src/index";
import type { FetchFn } from "../src/openrouter";
import { acceptanceSummary, goldenRequest, scoreSelection, type GoldenSet, type LiveResults } from "./golden";

/** Re-run raw answers through production validation; saved selections are not evidence. */
export async function replayRecorded(golden: GoldenSet, live: LiveResults) {
  const results = [];
  for (const recorded of live.cases) {
    const testCase = golden.cases.find((c) => c.id === recorded.id);
    if (!testCase) throw new Error("Recording contains unknown golden ID");
    if (!recorded.upstream_answer) throw new Error("Recording has no raw upstream answer");
    const handler = createHandler({
      config: loadConfig({ OPENROUTER_API_KEY: "offline-test-key", DECIDER_MODELS: live.decider_model }),
      fetchFn: (async () => new Response(JSON.stringify(recorded.upstream_answer), {
        status: recorded.upstream_status ?? 500,
        headers: { "Content-Type": "application/json" },
      })) as unknown as FetchFn,
    });
    const request = goldenRequest(golden, testCase);
    const response = await handler(new Request("http://localhost/routes:select", {
      method: "POST", body: JSON.stringify(request),
    }));
    const body = await response.json();
    const first = body.route_selection?.[0];
    results.push({
      ...recorded,
      ...scoreSelection(testCase, request, first?.route_option),
      router_status: response.status,
      source: first?.params?.source ?? "missing",
    });
  }
  return acceptanceSummary(golden, results);
}
