import type { RouteOption, SelectRouteRequest } from "./types";

// Deterministic local fallback: no network, no randomness, no clock.
// Used when there is no OpenRouter key or every decider model failed.

const HIGH_TIER = [/opus/i, /gpt-5/i, /gpt-4o(?!-mini)/i, /o3/i, /o1/i, /\bpro\b/i, /405b/i, /70b/i, /sonnet/i];
const MID_TIER = [/gpt-4/i, /llama-3\.3/i, /gemini/i, /claude/i, /32b/i, /27b/i];
const FAST_CHEAP = [/mini/i, /flash/i, /lite/i, /haiku/i, /nano/i, /8b/i, /7b/i, /3b/i, /:free$/i, /free/i];

const COMPLEX_KEYWORDS = [
  "refactor", "architecture", "architect", "debug", "migrate", "migration",
  "design", "algorithm", "optimise", "optimize", "security", "concurrency",
  "distributed", "tests", "test suite", "performance", "analyse", "analyze",
  "investigate", "root cause", "implement", "build a", "create a system",
];
const SIMPLE_KEYWORDS = [
  "typo", "rename", "format", "formatting", "comment", "spelling",
  "fix a typo", "whitespace", "indent", "one-liner", "small fix",
];

export function capabilityTier(option: RouteOption): number {
  const name = option.model;
  if (HIGH_TIER.some((re) => re.test(name))) return 3;
  if (MID_TIER.some((re) => re.test(name))) return 2;
  if (FAST_CHEAP.some((re) => re.test(name))) return 1;
  return 2; // unknown models are treated as mid-tier
}

export function cheapness(option: RouteOption): number {
  // Higher = cheaper/faster, judged purely from the model name.
  const name = option.model;
  let score = 0;
  if (/:free$/i.test(name) || /free/i.test(name)) score += 2;
  if (/mini|flash|lite|haiku|nano/i.test(name)) score += 3;
  if (/8b|7b|3b/i.test(name)) score += 1;
  return score;
}

export function taskComplexity(prompt: string): { score: number; level: "simple" | "medium" | "complex" } {
  const text = prompt.toLowerCase();
  let score = 0;
  if (prompt.length > 300) score += 1;
  if (prompt.length > 800) score += 1;
  if (prompt.length > 2000) score += 1;
  for (const kw of COMPLEX_KEYWORDS) if (text.includes(kw)) score += 2;
  for (const kw of SIMPLE_KEYWORDS) if (text.includes(kw)) score -= 2;
  const level = score >= 3 ? "complex" : score <= 0 ? "simple" : "medium";
  return { score, level };
}

export function rankHeuristically(req: SelectRouteRequest): { ranking: number[]; rationale: string } {
  const { level } = taskComplexity(req.task.prompt);
  const options = req.route_options;

  const keyed = options.map((option, index) => ({ index, tier: capabilityTier(option), cheap: cheapness(option) }));
  const byIndex = (a: { index: number }, b: { index: number }) => a.index - b.index;

  let sorted: typeof keyed;
  if (level === "complex") {
    // Hardest task -> most capable model first.
    sorted = [...keyed].sort((a, b) => b.tier - a.tier || a.cheap - b.cheap || byIndex(a, b));
  } else if (level === "simple") {
    // Easy task -> fastest/cheapest model first, don't waste a big model.
    sorted = [...keyed].sort((a, b) => b.cheap - a.cheap || a.tier - b.tier || byIndex(a, b));
  } else {
    // Medium task -> prefer mid-tier (good enough, usually cheaper), then high, then low.
    const distance = (tier: number) => Math.abs(tier - 2);
    sorted = [...keyed].sort((a, b) => distance(a.tier) - distance(b.tier) || b.cheap - a.cheap || byIndex(a, b));
  }

  const ranking = sorted.map((k) => k.index);
  const best = options[ranking[0]!]!;
  const rationale =
    `Heuristic fallback (no decider model available): task looks ${level}, ` +
    `so ${best.model}${best.harness ? ` via ${best.harness}` : ""} was ranked first ` +
    (level === "complex"
      ? "as the most capable offered option."
      : level === "simple"
        ? "as the fastest/cheapest offered option."
        : "as a balanced mid-tier offered option.");
  return { ranking, rationale };
}
