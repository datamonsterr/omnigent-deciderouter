import type { Config } from "./config";
import { chatCompletionsUrl } from "./config";
import type { SelectRouteRequest } from "./types";

export type FetchFn = typeof fetch;

export interface ModelAnswer {
  ranking: number[];
  rationale: string;
}

/** Models whose id contains "decide", or that are listed in DECISIONS_MODELS,
 *  use the OpenRouter Decisions API. Everything else uses Chat Completions. */
export function isDecisionModel(model: string, config: Config): boolean {
  return model.toLowerCase().includes("decide") || config.decisionsModels.includes(model);
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://github.com/datamonsterr/omnigent-openrouter-router",
    "X-Title": "omnigent-openrouter-router",
  };
}

async function fetchWithTimeout(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (HTTP ${res.status})`);
  }
}

function ensureOk(res: Response): void {
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
}

/** Keep only valid, unique indices, then append any missing ones in order. */
export function sanitizeRanking(ranking: unknown, count: number): number[] {
  const out: number[] = [];
  if (Array.isArray(ranking)) {
    for (const v of ranking) {
      if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < count && !out.includes(v)) {
        out.push(v);
      }
    }
  }
  for (let i = 0; i < count; i++) if (!out.includes(i)) out.push(i);
  return out;
}

export function optionKey(index: number): string {
  return `option_${index}`;
}

export function optionLabel(req: SelectRouteRequest, index: number): string {
  const o = req.route_options[index]!;
  return o.harness ? `${o.model} via ${o.harness}` : o.model;
}

function decisionContext(req: SelectRouteRequest) {
  const state: Record<string, unknown> = {
    task: req.task.prompt,
    route_options: req.route_options,
  };
  if (req.session_history !== undefined) state.session_history = req.session_history;
  return state;
}

// --- Transport 1: OpenRouter Decisions API ---------------------------------

export async function askDecisionsModel(
  model: string,
  req: SelectRouteRequest,
  config: Config,
  fetchFn: FetchFn,
  timeoutMs: number,
): Promise<ModelAnswer> {
  const criteria: Record<string, string> = {};
  req.route_options.forEach((_, i) => {
    criteria[optionKey(i)] = optionLabel(req, i);
  });

  const body = {
    model,
    state: decisionContext(req),
    questions: {
      route_decision: {
        type: "choice",
        instructions:
          "Rank the route options for this task, best first. Prefer the least " +
          "powerful/cheapest option that can do the task well; use a stronger " +
          "option only when the task's complexity justifies it.",
        criteria,
      },
    },
  };

  const res = await fetchWithTimeout(
    fetchFn,
    config.decisionsUrl,
    { method: "POST", headers: headers(config.openRouterApiKey!), body: JSON.stringify(body) },
    timeoutMs,
  );
  ensureOk(res);
  const data = (await readJson(res)) as {
    answers?: { route_decision?: { choice?: unknown; probabilities?: Record<string, unknown> } };
  };
  const answer = data.answers?.route_decision;
  if (!answer) throw new Error("Decisions API response had no route_decision answer");

  let ranking: number[];
  if (answer.probabilities && typeof answer.probabilities === "object") {
    const scored = req.route_options.map((_, i) => {
      const p = answer.probabilities![optionKey(i)];
      return { i, p: typeof p === "number" ? p : 0 };
    });
    scored.sort((a, b) => b.p - a.p || a.i - b.i);
    ranking = scored.map((s) => s.i);
  } else if (typeof answer.choice === "string") {
    const first = Number.parseInt(answer.choice.replace("option_", ""), 10);
    ranking = sanitizeRanking([first], req.route_options.length);
  } else {
    throw new Error("Decisions API answer had neither probabilities nor a choice");
  }

  const best = optionLabel(req, ranking[0]!);
  return {
    ranking: sanitizeRanking(ranking, req.route_options.length),
    rationale: `Decisions model ${model} ranked ${best} first for this task.`,
  };
}

// --- Transport 2: OpenRouter Chat Completions -------------------------------

const CHAT_SYSTEM_PROMPT =
  "You are a routing decider. Choose the best route option for the task. " +
  "Prefer the least powerful/cheapest option that can do the task well; use a " +
  'stronger option only when complexity justifies it. Reply with ONLY JSON: ' +
  '{"ranking":[option indices, best first],"rationale":"one short sentence"}';

export function parseChatRanking(content: string, count: number): ModelAnswer {
  const cleaned = content.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Chat model did not return JSON");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { ranking?: unknown; rationale?: unknown };
  if (!Array.isArray(parsed.ranking) || parsed.ranking.length === 0) {
    throw new Error("Chat model JSON had no ranking");
  }
  return {
    ranking: sanitizeRanking(parsed.ranking, count),
    rationale: typeof parsed.rationale === "string" && parsed.rationale ? parsed.rationale : "",
  };
}

export async function askChatModel(
  model: string,
  req: SelectRouteRequest,
  config: Config,
  fetchFn: FetchFn,
  timeoutMs: number,
): Promise<ModelAnswer> {
  const optionsText = req.route_options.map((_, i) => `${i}: ${optionLabel(req, i)}`).join("\n");
  const body = {
    model,
    messages: [
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Task:\n${req.task.prompt}\n\nRoute options (index: model via harness):\n${optionsText}`,
      },
    ],
    temperature: 0,
  };

  const res = await fetchWithTimeout(
    fetchFn,
    chatCompletionsUrl(config),
    { method: "POST", headers: headers(config.openRouterApiKey!), body: JSON.stringify(body) },
    timeoutMs,
  );
  ensureOk(res);
  const data = (await readJson(res)) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Chat response had no message content");
  const answer = parseChatRanking(content, req.route_options.length);
  if (!answer.rationale) {
    answer.rationale = `Chat decider model ${model} ranked ${optionLabel(req, answer.ranking[0]!)} first for this task.`;
  }
  return answer;
}
