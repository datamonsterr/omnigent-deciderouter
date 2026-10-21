# Delivery selector evidence (2026-10-21)

Installed the five project skills with `bun run skills:install`; all five
SKILL.md SHA256 values match `.agents/skills-manifest.json`.
The installer fetched pinned repositories through authenticated `gh repo clone`.
The mismatch regression proves an existing skill survives failed verification.

Runtime provenance (verified by the wrapper before execution):
- Origin: `datamonsterr/jev_auto_select_skills`
- Commit: `68cbbeca4e22750c87869578e970b00def6b1450`
- Clean checkout: `/home/dat/dev/jev_skill_selector`
- Explicit `JEV_PATH` takes precedence; arbitrary PATH executables are refused.
- Exclusive bank: `/home/dat/dev/omnigent-deciderouter-delivery/.agents/jev_skills`
- Model: `inception/mercury-decide:free`
- Served: `inception/mercury-decide-20260930`

Prompt: Fix OpenRouter Decisions API validation, write Bun tests with mocked
fetch, and secure GitHub Actions CI.

| Selected skill | Probability |
| --- | --- |
| bun-test-mocking | 0.3673 |
| openrouter-decisions | 0.2228 |
| github-actions-templates | 0.0929 |

Primary: `bun-test-mocking`. 324 total tokens (323 input, 1 output), cost $0.
The selected SKILL.md files and OpenRouter Decisions reference were read.

Invocation (credential loaded only from the approved 0600 file into child env,
never argv; no global configuration changed):

```sh
JEV_PATH=/home/dat/dev/jev_skill_selector \
SKILL_SELECTOR_MODEL=inception/mercury-decide:free \
SKILL_SELECTOR_EXCLUSIVE=1 \
SKILL_SELECTOR_AGENT_SKILLS_PATH=$PWD/.agents/jev_skills \
.agents/skills/jev-skill-selector/run.sh \
  "Fix OpenRouter Decisions API validation, write Bun tests with mocked fetch, and secure GitHub Actions CI" --json
```
