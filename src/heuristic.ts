import { modelProfile, optionLabel } from "./catalog";
import type { RouteOption, SelectRouteRequest } from "./types";

// Deterministic local fallback: no network, no randomness, no clock.
// Used when there is no OpenRouter key or every decider model failed.

// Name-based inference for models without a catalog profile. Fast markers are
// checked first so "flash-lite" / "gpt-5-mini" are not promoted by family.
const FAST_CHEAP = [/mini/i, /flash-lite/i, /\blite\b/i, /haiku/i, /nano/i, /\b[1-9]b\b/i, /-low$/i, /free/i];
const HIGH_TIER = [/opus/i, /gpt-[56]/i, /gpt-4o/i, /^(openai\/)?o[134]\b/i, /\bpro\b/i, /405b/i, /70b/i, /sonnet/i, /-high$/i];
const MID_TIER = [/gpt-4/i, /llama/i, /gemini/i, /claude/i, /32b/i, /27b/i, /-medium$/i];

// Keyword weights: hard engineering signals, multi-file scope, routine work, trivial edits.
const COMPLEX_KEYWORDS = [
  "race condition", "deadlock", "concurren", "security", "vulnerab", "privilege", "timing attack",
  "root cause", "intermittent", "nondetermin", "flaky", "memory leak", "architecture", "distributed",
  "algorithm", "migrate", "migration", "zero-downtime", "subtle", "debug", "diagnose", "investigate",
  "audit", "property-based", "clock skew", "rewrite", "event-sourcing", "edge cases",
];
const SCOPE_KEYWORDS = [
  "across", "multi-file", "files", "components", "wire it", "port the", "interface", "multi-step",
  "decompose", "slices", "several steps", "multi-component",
];
const ROUTINE_KEYWORDS = [
  "implement", "add a", "endpoint", "unit test", "tests", "schema", "validation", "flag", "helper",
  "query", "migration file", "page", "section", "design.md", "component",
];
const SIMPLE_KEYWORDS = [
  "typo", "rename", "spelling", "whitespace", "formatter", "formatting", "comment", "copyright",
  "bump", ".gitignore", "broken", "one-line", "five-line", "constant", "small fix",
];

export function capabilityTier(option: RouteOption): number {
  const profile = modelProfile(option);
  if (profile) return profile.tier;
  const name = option.model;
  if (FAST_CHEAP.some((re) => re.test(name))) return 1;
  if (HIGH_TIER.some((re) => re.test(name))) return 3;
  if (MID_TIER.some((re) => re.test(name))) return 2;
  return 2; // unknown models are treated as mid-tier
}

export function cheapness(option: RouteOption): number {
  // Higher = cheaper/faster, judged from the profile or the model name.
  const profile = modelProfile(option);
  if (profile) return profile.cheapness;
  const name = option.model;
  let score = 0;
  if (/free/i.test(name)) score += 2;
  if (/mini|flash|lite|haiku|nano|-low$/i.test(name)) score += 3;
  if (/lite|nano/i.test(name)) score += 1; // smallest variant of a family
  if (/\b[1-9]b\b/i.test(name)) score += 1;
  return score;
}

function countMatches(text: string, keywords: string[]): number {
  return keywords.filter((kw) => text.includes(kw)).length;
}

export function taskComplexity(prompt: string): { score: number; level: "simple" | "medium" | "complex" } {
  const text = prompt.toLowerCase();
  let score = 0;
  if (prompt.length > 300) score += 1;
  if (prompt.length > 800) score += 1;
  if (prompt.length > 2000) score += 1;
  score += 4 * countMatches(text, COMPLEX_KEYWORDS);
  score += 2 * countMatches(text, SCOPE_KEYWORDS);
  score += 1 * countMatches(text, ROUTINE_KEYWORDS);
  score -= 3 * countMatches(text, SIMPLE_KEYWORDS);
  const level = score >= 4 ? "complex" : score <= 0 ? "simple" : "medium";
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
    `so ${optionLabel(best)} was ranked first ` +
    (level === "complex"
      ? "as the most capable offered option."
      : level === "simple"
        ? "as the fastest/cheapest offered option."
        : "as a balanced mid-tier offered option.");
  return { ranking, rationale };
}
