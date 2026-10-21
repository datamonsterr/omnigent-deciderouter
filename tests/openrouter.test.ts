import { describe, expect, it } from "bun:test";
import { DEFAULT_DECIDER_MODELS, loadConfig } from "../src/config";
import { askDecisionsModel, rankDecisionsAnswer, isDecisionModel, openRouterHeaders, type FetchFn } from "../src/openrouter";
import type { SelectRouteRequest } from "../src/types";

const config = loadConfig({ OPENROUTER_BASE_URL: "https://mock.openrouter.test", OPENROUTER_API_KEY: "test-key" });

const request: SelectRouteRequest = {
  route_options: [
    { model: "gpt-6-luna", harness: "codex" },
    { model: "gpt-6.1-sol", harness: "codex" },
  ],
  task: { prompt: "Fix a subtle deadlock in the connection pool" },
  route_selector: { router_name: "deciderouter_v1" },
};

function decisionsReply(answer: unknown, model = "inception/mercury-decide-20260930"): FetchFn {
  return (async () =>
    new Response(JSON.stringify({ model, answers: { route_decision: answer }, usage: { input_tokens: 1, output_tokens: 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as FetchFn;
}

describe("isDecisionModel", () => {
  it.each([
    "inception/mercury-decide:free",
    "~typesafe/jev-latest",
    "typesafe/jev-1.14",
    "perplexity/pplx-decider-flash-v1.2",
    "upstage/solar-decide-flash",
    "openai/gpt-6-luna-decisions",
  ])("routes %s to the Decisions API", (model) => {
    expect(isDecisionModel(model, config)).toBe(true);
  });

  it.each(["google/gemini-2.5-flash-lite", "acme/undecided-chat-7b", "meta-llama/llama-3.3-70b-instruct"])(
    "routes %s to Chat Completions",
    (model) => {
      expect(isDecisionModel(model, config)).toBe(false);
    },
  );

  it("honours DECISIONS_MODELS for decisions models without a recognizable name", () => {
    const withExtra = loadConfig({ DECISIONS_MODELS: "liquid/d1" });
    expect(isDecisionModel("liquid/d1", withExtra)).toBe(true);
    expect(isDecisionModel("liquid/d1", config)).toBe(false);
  });
});

describe("default decider chain", () => {
  it("does not include the retired llama-3.3-70b :free variant", () => {
    expect(DEFAULT_DECIDER_MODELS).not.toContain("meta-llama/llama-3.3-70b-instruct:free");
  });

  it("starts with the free mercury decisions model", () => {
    expect(DEFAULT_DECIDER_MODELS[0]).toBe("inception/mercury-decide:free");
  });
});

describe("openRouterHeaders", () => {
  it("attributes requests to this repository with the current title header", () => {
    const headers = openRouterHeaders("k");
    expect(headers["HTTP-Referer"]).toBe("https://github.com/datamonsterr/omnigent-deciderouter");
    expect(headers["X-OpenRouter-Title"]).toBe("omnigent-deciderouter");
  });
});

describe("askDecisionsModel response validation", () => {
  it("ranks offered options by probability and reports the served model", async () => {
    const answer = await askDecisionsModel(
      "inception/mercury-decide:free",
      request,
      config,
      decisionsReply({ type: "choice", choice: "option_1", confidence: 0.9, probabilities: { option_0: 0.2, option_1: 0.8 } }),
      1000,
    );
    expect(answer.ranking).toEqual([1, 0]);
    expect(answer.servedModel).toBe("inception/mercury-decide-20260930");
  });

  it("rejects a choice that was not offered", async () => {
    const fetchFn = decisionsReply({ type: "choice", choice: "option_7", probabilities: { option_7: 1 } });
    await expect(askDecisionsModel("inception/mercury-decide:free", request, config, fetchFn, 1000)).rejects.toThrow(
      /not offered/,
    );
  });

  it("rejects a non-choice answer", async () => {
    const fetchFn = decisionsReply({ type: "noul", noul: 0.4 });
    await expect(askDecisionsModel("inception/mercury-decide:free", request, config, fetchFn, 1000)).rejects.toThrow(
      /choice/,
    );
  });

  it("rejects probabilities that cover none of the offered options", async () => {
    const fetchFn = decisionsReply({ type: "choice", choice: "option_0", probabilities: { other: 1 } });
    await expect(askDecisionsModel("inception/mercury-decide:free", request, config, fetchFn, 1000)).rejects.toThrow(
      /probabilit/,
    );
  });

  it("describes each option to the decision model with its catalog profile", async () => {
    let sentBody: { questions: { route_decision: { criteria: Record<string, string> } } } | undefined;
    const fetchFn = (async (_url: unknown, init: RequestInit) => {
      sentBody = JSON.parse(String(init.body));
      return decisionsReply({ type: "choice", choice: "option_1", probabilities: { option_0: 0.1, option_1: 0.9 } })(
        "",
        {},
      );
    }) as unknown as FetchFn;
    await askDecisionsModel("inception/mercury-decide:free", request, config, fetchFn, 1000);
    const criteria = sentBody!.questions.route_decision.criteria;
    expect(Object.keys(criteria)).toEqual(["option_0", "option_1"]);
    expect(criteria.option_0).toContain("gpt-6-luna via codex");
    expect(criteria.option_1.toLowerCase()).toContain("subtle bugs");
  });
});

describe("choice probability contract", () => {
  it.each([
    { option_0: 0.9, option_1: 0.1, unoffered: 0 },
    { option_0: -0.1, option_1: 0.9 },
    { option_0: 1.1, option_1: 0 },
    { option_0: NaN, option_1: 0 },
    { option_0: Infinity, option_1: 0 },
    { option_0: "0.9", option_1: 0.1 },
    { option_0: 0.1, option_1: 0.9 },
    { option_1: 1 },
    null,
    { option_0: 0.8, option_1: null },
    {},
  ])("rejects malformed or conflicting probabilities %j", (probabilities) => {
    expect(() => rankDecisionsAnswer({ type: "choice", choice: "option_0", probabilities }, 2)).toThrow();
  });

  it.each([-1, 1.1, NaN, Infinity, "0.8", null])("rejects invalid confidence %j", (confidence) => {
    expect(() => rankDecisionsAnswer({ type: "choice", choice: "option_0", confidence }, 2)).toThrow();
  });

  it.each([undefined, 0, 0.8, 1])("accepts optional valid confidence %j", (confidence) => {
    expect(rankDecisionsAnswer({ type: "choice", choice: "option_0", confidence }, 2)).toEqual([0, 1]);
  });

  it("accepts a tied maximum and keeps the chosen tied option first", () => {
    expect(rankDecisionsAnswer({
      type: "choice", choice: "option_1", probabilities: { option_0: 0.5, option_1: 0.5 },
    }, 2)).toEqual([1, 0]);
  });
});

it("rejects array probabilities through the transport and accepts optional probability omission", async () => {
  await expect(askDecisionsModel("inception/mercury-decide:free", request, config,
    decisionsReply({ type: "choice", choice: "option_0", probabilities: [0.9, 0.1] }), 1000)).rejects.toThrow(/probabilit/);
  expect((await askDecisionsModel("inception/mercury-decide:free", request, config,
    decisionsReply({ type: "choice", choice: "option_1", confidence: 0 }), 1000)).ranking).toEqual([1, 0]);
});
