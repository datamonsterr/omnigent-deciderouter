// Configuration from environment variables. See .env.example / README.

export interface Config {
  port: number;
  host: string;
  /** Optional: without it the server still runs, using the heuristic only. */
  openRouterApiKey?: string;
  /** Optional: when set, POST /routes:select requires this Bearer token. */
  routerApiKey?: string;
  /** Decision-model chain, tried in order (free first, then cheap). */
  deciderModels: string[];
  /** Model ids (exact) that must use the OpenRouter Decisions API.
   *  Any model whose id contains "decide" also uses it by default. */
  decisionsModels: string[];
  /** Overall decision budget in milliseconds. */
  timeoutMs: number;
  /** Base URL used to build both OpenRouter endpoint URLs (test override). */
  openRouterBaseUrl: string;
  /** Full override for the Decisions API URL, if set. */
  decisionsUrl: string;
}

export const DEFAULT_DECIDER_MODELS = [
  "inception/mercury-decide:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemini-2.5-flash-lite",
];

type Env = Record<string, string | undefined>;

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: Env = process.env): Config {
  const base = (env.OPENROUTER_BASE_URL || "https://openrouter.ai").replace(/\/+$/, "");
  const deciderModels = splitList(env.DECIDER_MODELS);
  return {
    port: parsePositiveInt(env.PORT, 8080),
    host: env.HOST || "0.0.0.0",
    openRouterApiKey: env.OPENROUTER_API_KEY || undefined,
    routerApiKey: env.ROUTER_API_KEY || undefined,
    deciderModels: deciderModels.length ? deciderModels : [...DEFAULT_DECIDER_MODELS],
    decisionsModels: splitList(env.DECISIONS_MODELS),
    timeoutMs: parsePositiveInt(env.ROUTER_TIMEOUT_MS, 8000),
    openRouterBaseUrl: base,
    decisionsUrl: env.OPENROUTER_DECISIONS_URL || `${base}/api/alpha/decisions`,
  };
}

export function chatCompletionsUrl(config: Config): string {
  return `${config.openRouterBaseUrl}/api/v1/chat/completions`;
}
