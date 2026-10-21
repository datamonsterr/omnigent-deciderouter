import { describe, expect, it } from "bun:test";
import { capabilityTier, cheapness, taskComplexity } from "../src/heuristic";

describe("capabilityTier with current Polly catalog names", () => {
  it.each([
    ["gpt-6.1-sol", "codex", 3],
    ["gpt-6-luna", "codex", 2],
    ["gemini-3.8-flash-high", "agy", 3],
    ["gemini-3.8-flash-medium", "agy", 2],
    ["gemini-3.8-flash-low", "agy", 1],
    ["opencode/deepseek-v4.1-flash-free", "opencode", 1],
    ["opencode-go/muse-spark-1.3-contributor", "opencode", 3],
  ])("%s via %s is tier %d", (model, harness, tier) => {
    expect(capabilityTier({ model, harness })).toBe(tier);
  });

  it("keeps recognizing older generic names", () => {
    expect(capabilityTier({ model: "anthropic/claude-opus-4" })).toBe(3);
    expect(capabilityTier({ model: "google/gemini-2.5-flash-lite" })).toBe(1);
  });
});

describe("cheapness", () => {
  it("ranks the free and low-effort workers as cheapest", () => {
    const free = cheapness({ model: "opencode/deepseek-v4.1-flash-free", harness: "opencode" });
    const low = cheapness({ model: "gemini-3.8-flash-low", harness: "agy" });
    const sol = cheapness({ model: "gpt-6.1-sol", harness: "codex" });
    expect(free).toBeGreaterThan(sol);
    expect(low).toBeGreaterThan(sol);
  });
});

describe("taskComplexity", () => {
  it.each([
    ["Fix the typo in README.md", "simple"],
    ["Add a GET /healthz endpoint with one unit test", "medium"],
    ["Diagnose an intermittent race condition and fix the root cause", "complex"],
  ])("%s is %s", (prompt, level) => {
    expect<string>(taskComplexity(prompt).level).toBe(level);
  });
});
