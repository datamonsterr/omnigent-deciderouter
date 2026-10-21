# Jev skill selector: real invocations (2026-10-21)

Selector: `.agents/skills/jev-skill-selector/run.sh` (runtime
`~/dev/jev_skill_selector` at `68cbbec`, free model
`inception/mercury-decide:free`). Bank: `.agents/jev_skills` installed with
`bun run skills:install`.

Command shape (exclusive project bank):

```sh
SKILL_SELECTOR_EXCLUSIVE=1 SKILL_SELECTOR_AGENT_SKILLS_PATH=$PWD/.agents/jev_skills \
  .agents/skills/jev-skill-selector/run.sh "<prompt>"
```

| Prompt | Primary choice | Probability |
| --- | --- | --- |
| Fix the OpenRouter Decisions API transport so Jev decision models are detected and responses are validated | openrouter-decisions | 99.9% |
| Write bun:test unit tests that mock fetch for the router handler | bun-test-mocking | 99.8% |
| Set up a GitHub Actions CI workflow with pinned action SHAs, typecheck, tests and Docker build | github-actions-templates | 100.0% |
| List current OpenRouter models with pricing and check whether a model id still exists | openrouter-models | 99.8% |
| Use describe/it.each and expect assertions in bun test | bun-test-basics | 100.0% |

Each call used about 320 tokens (one output token).

Default (non-exclusive) mode searches the project bank and then the global
`~/.agents/jev_skills` bank. There, "Fix the OpenRouter Decisions API transport
so Jev decision models are detected" picked the global `jev-skill-selector`
skill (99.9%) because the word "Jev" matches that skill. Use the exclusive
command above when only this project's skills should be offered.
