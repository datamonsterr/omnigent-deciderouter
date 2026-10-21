import { describe, expect, it } from "bun:test";
import { loadConfig, type Config } from "../src/config";
import { createHandler } from "../src/index";
import type { FetchFn } from "../src/openrouter";

const OPTIONS = [
  { model: "anthropic/claude-opus-4", harness: "claude-code" },
  { model: "openai/gpt-5-mini", harness: "codex" },
  { model: "google/gemini-2.5-flash-lite", harness: "opencode" },
];

function makeConfig(env: Record<string, string | undefined> = {}): Config {
  return loadConfig({ OPENROUTER_BASE_URL: "https://mock.openrouter.test", ...env });
}

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    route_options: OPTIONS,
    task: { prompt: "Refactor the authentication module and migrate the database schema" },
    route_selector: { router_name: "task_v0" },
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return new Request("http://localhost:8080/routes:select", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: raw ?? JSON.stringify(body),
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("validation", () => {
  const handler = createHandler({ config: makeConfig() });

  it("returns 400 without route_selector", async () => {
    const { route_selector: _omit, ...noSelector } = requestBody();
    const res = await handler(post(noSelector));
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty route_options", async () => {
    const res = await handler(post(requestBody({ route_options: [] })));
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await handler(post(null, {}, "{not json"));
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown paths", async () => {
    const res = await handler(new Request("http://localhost:8080/nope"));
    expect(res.status).toBe(404);
  });
});

describe("healthz", () => {
  it("reports ok, service name and decider chain", async () => {
    const handler = createHandler({ config: makeConfig() });
    const res = await handler(new Request("http://localhost:8080/healthz"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("omnigent-openrouter-router");
    expect(body.decider_models[0]).toBe("inception/mercury-decide:free");
  });
});

describe("decisions API path", () => {
  it("ranks by probabilities and returns only offered options", async () => {
    const seenUrls: string[] = [];
    const mockFetch = (async (input: unknown) => {
      seenUrls.push(String(input));
      return jsonResponse({
        answers: {
          route_decision: {
            type: "choice",
            choice: "option_1",
            probabilities: { option_0: 0.1, option_1: 0.7, option_2: 0.2 },
            confidence: 0.8,
          },
        },
      });
    }) as unknown as FetchFn;

    const handler = createHandler({
      config: makeConfig({ OPENROUTER_API_KEY: "test-key" }),
      fetchFn: mockFetch,
    });
    const res = await handler(post(requestBody()));
    expect(res.status).toBe(200);
    expect(seenUrls[0]).toBe("https://mock.openrouter.test/api/alpha/decisions");

    const body = await res.json();
    expect(body.route_selection).toHaveLength(3);
    expect(body.route_selection[0].route_option).toEqual(OPTIONS[1]);
    expect(body.route_selection[0].params.source).toBe("decisions_api");
    expect(body.route_selection[0].params.decider_model).toBe("inception/mercury-decide:free");
    for (const sel of body.route_selection) {
      expect(OPTIONS).toContainEqual(sel.route_option);
    }
  });
});

describe("chat path", () => {
  it("parses a JSON ranking from a chat completion (code fences stripped)", async () => {
    const mockFetch = (async (input: unknown) => {
      expect(String(input)).toBe("https://mock.openrouter.test/api/v1/chat/completions");
      return jsonResponse({
        choices: [
          { message: { content: '```json\n{"ranking":[2,0,1],"rationale":"Easy task, cheapest first"}\n```' } },
        ],
      });
    }) as unknown as FetchFn;

    const handler = createHandler({
      config: makeConfig({
        OPENROUTER_API_KEY: "test-key",
        DECIDER_MODELS: "meta-llama/llama-3.3-70b-instruct:free",
      }),
      fetchFn: mockFetch,
    });
    const res = await handler(post(requestBody({ task: { prompt: "Fix a typo" } })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route_selection[0].route_option).toEqual(OPTIONS[2]);
    expect(body.route_selection[0].params.source).toBe("chat");
    expect(body.rationale).toContain("cheapest first");
  });
});

describe("chain fallthrough", () => {
  it("moves to the next model when the first fails", async () => {
    let calls = 0;
    const mockFetch = (async () => {
      calls++;
      if (calls === 1) return jsonResponse({ error: "rate limited" }, 429);
      return jsonResponse({
        choices: [{ message: { content: '{"ranking":[0,1,2],"rationale":"needs the big model"}' } }],
      });
    }) as unknown as FetchFn;

    const handler = createHandler({
      config: makeConfig({ OPENROUTER_API_KEY: "test-key" }),
      fetchFn: mockFetch,
    });
    const res = await handler(post(requestBody()));
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    const body = await res.json();
    expect(body.route_selection[0].route_option).toEqual(OPTIONS[0]);
    expect(body.route_selection[0].params.decider_model).toBe("meta-llama/llama-3.3-70b-instruct:free");
    expect(body.route_selection[0].params.source).toBe("chat");
  });
});

describe("heuristic fallback", () => {
  it("answers without an OpenRouter key, via the heuristic", async () => {
    const handler = createHandler({ config: makeConfig() }); // no key
    const res = await handler(post(requestBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route_selection[0].params.source).toBe("heuristic");
    // Complex refactor/migrate task -> most capable option first (opus).
    expect(body.route_selection[0].route_option).toEqual(OPTIONS[0]);
    expect(body.rationale.toLowerCase()).toContain("heuristic");
  });

  it("prefers the cheap/fast option for a simple task", async () => {
    const handler = createHandler({ config: makeConfig() });
    const res = await handler(post(requestBody({ task: { prompt: "Fix a typo and rename a variable" } })));
    const body = await res.json();
    expect(body.route_selection[0].route_option.model).toContain("flash-lite");
  });
});

describe("auth", () => {
  const config = makeConfig({ ROUTER_API_KEY: "s3cret" });
  const handler = createHandler({ config });

  it("returns 401 when the Bearer token is wrong or missing", async () => {
    expect((await handler(post(requestBody()))).status).toBe(401);
    expect((await handler(post(requestBody(), { Authorization: "Bearer wrong" }))).status).toBe(401);
  });

  it("returns 200 when the Bearer token is right", async () => {
    const res = await handler(post(requestBody(), { Authorization: "Bearer s3cret" }));
    expect(res.status).toBe(200);
  });
});
