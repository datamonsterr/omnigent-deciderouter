import type { RouteOption } from "./types";

// Known route-option profiles for the Polly worker catalog (codex, agy and
// opencode harnesses). Descriptions follow the operator's routing policy and
// are sent to decision models as criteria; tiers feed the local heuristic.
// Unknown models fall back to name-based inference in heuristic.ts.

export interface ModelProfile {
  /** Capability tier: 1 = fast/cheap, 2 = routine, 3 = most capable. */
  tier: 1 | 2 | 3;
  /** Higher = cheaper/faster. */
  cheapness: number;
  description: string;
}

interface ProfileRule {
  pattern: RegExp;
  harness?: RegExp;
  profile: ModelProfile;
}

const PROFILE_RULES: ProfileRule[] = [
  {
    pattern: /^gpt-6\.1-sol$/i,
    profile: {
      tier: 3,
      cheapness: 0,
      description:
        "Deepest Codex worker: subtle bugs, concurrency or nondeterminism diagnosis, security fixes, " +
        "architecture, algorithms and multi-file feature slices. Most expensive; overkill for small edits.",
    },
  },
  {
    pattern: /^gpt-6-luna$/i,
    profile: {
      tier: 2,
      cheapness: 2,
      description:
        "Fast, cheap Codex worker for routine bounded implementation, unit tests, docs, small fixes and " +
        "CI repairs with clear acceptance. Not for subtle bugs, security or architecture.",
    },
  },
  {
    pattern: /flash-low$/i,
    profile: {
      tier: 1,
      cheapness: 4,
      description:
        "Cheapest worker with low reasoning: trivial bounded tasks such as typos, renames, tiny edits, " +
        "boilerplate, simple scripts and straightforward docs. Too weak for features or debugging.",
    },
  },
  {
    pattern: /flash-medium$/i,
    profile: {
      tier: 2,
      cheapness: 3,
      description:
        "Fast worker with medium reasoning: routine implementation, API endpoints, bounded feature slices, " +
        "unit tests, routine UI/frontend and design specs. Not needed for trivial one-line edits.",
    },
  },
  {
    pattern: /flash-high$/i,
    profile: {
      tier: 3,
      cheapness: 1,
      description:
        "Strong reasoning worker: complex tasks, subtle bugs, concurrency diagnosis, security review, " +
        "algorithms, edge cases and architecture. Overkill for trivial or routine edits.",
    },
  },
  {
    pattern: /deepseek-v[\d.]+-flash-free$/i,
    profile: {
      tier: 1,
      cheapness: 5,
      description:
        "Free small worker: small bounded tasks, routine edits, quick scripts, docs and simple tests. " +
        "Too weak for complex debugging, security or architecture.",
    },
  },
  {
    pattern: /muse-spark/i,
    profile: {
      tier: 3,
      cheapness: 1,
      description:
        "Long-horizon worker: long multi-step implementation, decomposing multi-component work into " +
        "slices, multi-file synthesis and TDD across several steps. Wasteful for small or single-step tasks.",
    },
  },
];

export function modelProfile(option: RouteOption): ModelProfile | undefined {
  return PROFILE_RULES.find(
    (rule) => rule.pattern.test(option.model) && (!rule.harness || rule.harness.test(option.harness ?? "")),
  )?.profile;
}

export function optionLabel(option: RouteOption): string {
  return option.harness ? `${option.model} via ${option.harness}` : option.model;
}

/** Criterion text for a decision model: the label plus the known profile, if any. */
export function describeOption(option: RouteOption): string {
  const profile = modelProfile(option);
  return profile ? `${optionLabel(option)}. ${profile.description}` : optionLabel(option);
}
