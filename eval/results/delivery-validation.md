# Validated delivery evidence

Delivery branch: `setup/validated-router-delivery` in
`/home/dat/dev/omnigent-deciderouter-delivery`.
Base: `3021bef6c99dca4f1f459e142359b044256010b7`.
PR: https://github.com/datamonsterr/omnigent-deciderouter/pull/2 (supersedes #1).
Cherry-picked source: `874550c49356b02ac900e36f0f32bcffc79312de` as
`154e9ecac1a6ce61776e2b9e6825cb55a8a9b334`.

## Local gates

`bun install --frozen-lockfile` passed with Bun 1.3.14. `bun run check`
passed: `tsc --noEmit`, **103 collected test cases across 8 files**, 0 failures,
and `bun build src/index.ts --target=bun --outdir=dist` (6 modules).
The eight files are `heuristic.test.ts`, `golden.test.ts`,
`openrouter.test.ts`, `router.test.ts`, `evaluation.test.ts`,
`install-skills.test.ts`, `selector.test.ts`, and `runtime-baseline.test.ts`
under `tests/`. Parameterized cases are included in the 103 count.

Focused commands passed:

| Command | Collected cases | Result |
| --- | ---: | --- |
| `bun test tests/openrouter.test.ts tests/router.test.ts` | 55 | 0 failures |
| `bun test tests/evaluation.test.ts tests/golden.test.ts` | 31 | 0 failures |
| `bun test tests/install-skills.test.ts tests/selector.test.ts` | 3 | 0 failures |
| `bun test tests/runtime-baseline.test.ts` | 2 | 0 failures |

Red/green runs reproduced invalid Decisions data being accepted, destructive
skill replacement on mismatch, PATH bypassing explicit selector configuration,
and absent production-chain error diagnostics. Count/gate tests cover partial,
empty and duplicated evidence, current labels, forbidden picks above 80%
accuracy, HTTP/fallback/latency/unoffered failures, and invalid CLI counts.
The CLI regression rejects `EVAL_MAX_CASES=1` before credentials or network.

`bash -n eval/probe.sh .agents/skills/jev-skill-selector/run.sh` and
`git diff --check` passed. This repository has no pre-commit configuration or
hook, lint script, test-helper guide, contributor guide, or PR template.

## Fresh live proof

Commands, in this order (credentials only from the approved 0600 file):

```sh
OPENROUTER_ENV_FILE=/home/dat/.config/omnigent-deciderouter/openrouter.env ./eval/probe.sh
OPENROUTER_ENV_FILE=/home/dat/.config/omnigent-deciderouter/openrouter.env bun run eval:live
bun run check:models
```

Final curl probe: HTTP 200, 0.992780 s, cost $0. Complete live evaluation:
40/40 router/upstream HTTP 200, 34/40 correct (85%), zero invalid, unoffered,
forbidden or fallback selections; p50 464 ms, p95 **1107 ms**, max 2013 ms.
Every gate is true; `summary.passed` is true. Model:
`inception/mercury-decide:free`, served build
`inception/mercury-decide-20260930`; total upstream cost $0.

`live-golden.json` contains the raw answers, mode, evaluated source revision
`21eeed6ac05336ef19f17d2f212536f8001e0a82` and SHA256 of every runtime/eval TS
file, the golden set, package manifest and lockfile. Subsequent changes affect
workflow/docs/evidence, installer and rollback tooling only; compare its hashes to verify source equivalence.
Recorded replay recomputes selections through the production handler and gates
against current labels instead of trusting saved selected/correct fields.

Catalog check passed: free Mercury supports Decisions, cheap Gemini supports
Chat; 27 current decision-model catalog entries were observed.

## Container and CI proof

`docker build -t omnigent-deciderouter:delivery .` passed. A disposable container
bound to a random loopback port returned health HTTP 200 and seven selections,
all copied from `examples/request.json`, via the heuristic (no credential).
This establishes container/transport behavior separately from live proof.

Initial hosted CI passed at the evaluated source revision:
https://github.com/datamonsterr/omnigent-deciderouter/actions/runs/39602741868
Both jobs used `namespace-profile-datamonster01`; logs show actual Namespace
runner `nsc-runner-4m6tknbgmd6c0` for Docker plus profile/instance URLs.
Final-head CI and explicit manual live run are linked on PR #2 after the
evidence commit. All actions are SHA-pinned, permissions read-only, frozen
install/typecheck/tests/build/Docker smoke are required, and jobs have bounded
timeouts/concurrency. PR-triggered live jobs are skipped before secret access;
only manual `workflow_dispatch` can run live calls with the Actions secret.

## Project skills and runtime baseline

`bun run skills:install` installed all five pinned project skills and verified
their SKILL.md hashes. Atomic replacement uses Linux renameat2 exchange via
Python 3. A separate concurrent-reader regression observed 581 missing-path
reads under the original two-rename implementation and zero after atomic
exchange; mismatched content still preserves the existing install. `skill-selector.md` records the actual exclusive-bank
Jev invocation and full provenance. It selected Bun mocking, OpenRouter
Decisions and GitHub Actions skills with free Mercury at zero cost. No global
hooks or configuration were changed.

Read-only capture command:

```sh
XDG_RUNTIME_DIR=/run/user/$(id -u) \
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus \
bun run deploy/runtime-baseline.ts .scratch/runtime-baseline
```

Observed process: PID 327001, working directory `/home/dat`, Python from the
existing Omnigent virtual environment, `server --host 127.0.0.1 --port 6767`,
13 `--agent` flags, **no `--config`**. Agent basenames: conductor-codex-1..5,
conductor-opencode, opencode, designer, agy-acc1..4, planner-codex. Pending
drop-ins: `50-polly.conf`, `60-stitch-env.conf`, `65-custom-agents.conf`.
The capture prepared an override in private scratch only. It never installed
a unit/drop-in, reloaded a daemon or restarted a service. The generated full
rollback unit passed `systemd-analyze --user verify
.scratch/restored-runtime.service` (exit 0) after a regression caught literal
quotes in WorkingDirectory. Smoke mode was also exercised through the real CLI:
one case, exit 0 for diagnostics, `summary.passed: false`. Private unit/config
snapshots are deleted with scratch; capture a fresh retained baseline at the
later authorized activation window.

## Remaining activation plan

Follow `deploy/README.md` after independent review approves the exact final
SHA and the operator authorizes a maintenance window. Recheck full live and
current-head CI, capture running argv/agents and pending startup configuration,
then install the reviewed loopback router using **free Mercury only**. Edit
only the routing mapping and add only its client credential/drop-in. Preserve
providers, account pools, MCP, `routing.env`, the built-in judge and Codex
`gpt-6-luna`/`gpt-6.1-sol` low/high policy. Authorize any pending startup/agent
list change separately before restarting. Verify real Polly advice and each
intended routing entry point. Rollback reverses only the routing patch and
adds the captured runtime override so the original start flags/agent list are
restored despite pending drop-ins. No activation or restart occurred here.

## Current interface references

Consulted official/context7 docs for
[OpenRouter Decisions](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request),
[Bun child processes](https://bun.sh/docs/runtime/child-process),
[GitHub workflow triggers](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
[systemd command lines](https://www.freedesktop.org/software/systemd/man/257/systemd.service.html),
and [Namespace profiles](https://namespace.so/github-actions).
