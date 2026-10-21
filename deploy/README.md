# Validation and deferred local activation

**No production service installation/start, Polly configuration edit, daemon
reload, or restart is authorized in this delivery stage.** An independent reviewer
must approve the exact candidate commit first. Loopback probe servers and
disposable Docker smoke containers are allowed during validation.

## 1. Validate the candidate before any production change

Use the delivery checkout, with Bun 1.3.14 and the credential only at
`/home/dat/.config/omnigent-deciderouter/openrouter.env` (0600). Never copy it
into the checkout or pass a literal key as a command argument.

```sh
bun install --frozen-lockfile
bun run check
OPENROUTER_ENV_FILE=/home/dat/.config/omnigent-deciderouter/openrouter.env ./eval/probe.sh
OPENROUTER_ENV_FILE=/home/dat/.config/omnigent-deciderouter/openrouter.env bun run eval:live
bun run check:models
```

The probe must precede the fresh full live run. Deploy acceptance requires
all **40 unique current golden IDs**, every router and upstream response HTTP
200, >=80% accuracy against current labels, zero invalid/unoffered/forbidden
picks, zero fallbacks, and p95 <3000 ms. A partial `eval:smoke` is diagnostic
only and always records `passed: false`; it cannot satisfy deployment gates.
Offline replay revalidates raw answers and re-scores current labels.

Before proceeding, retain the full live artifact and verify:
- The full live run above passed on the reviewed source.
- CI is green on the **exact current PR head SHA**, including frozen install,
  typecheck, tests, build and Docker smoke on `namespace-profile-datamonster01`.
- Independent cross-review of that SHA approved validation, activation and
  rollback. Any subsequent code change invalidates that approval.
- The operator explicitly authorizes activation and a maintenance window.
  Approval of this PR alone is not authorization to restart.

The remaining sections are **future operator instructions; do not execute
during delivery**. Recheck all gates before install, update, or activation.

## 2. Capture the runtime that rollback must restore

A restart can apply preexisting, pending drop-ins even if this router changes
only YAML. On the inspected host, the running process has 13 agents and no
`--config`; pending `50-polly.conf`, `60-stitch-env.conf` and
`65-custom-agents.conf` specify another agent list and server config. Do not
assume `systemctl show ExecStart` describes the currently running process.

After the gates and operator authorization, create a new private snapshot.
Do not overwrite an earlier snapshot. Keep it outside Git and retain it until
activation is accepted or rolled back.

```sh
umask 077
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus
snapshot="$HOME/.config/omnigent-deciderouter/baseline-$(date -u +%Y%m%dT%H%M%SZ)"
bun run deploy/runtime-baseline.ts "$snapshot"
```

The read-only capture records `/proc/MainPID/cmdline`, actual working directory,
executable, start flags, exact agent list, config flag, configured ExecStart,
unit/drop-ins and environment-file references. It copies the current
`server-polly.yaml` privately and prepares
`zz-deciderouter-runtime-rollback.conf` **inside the snapshot only**.
It refuses a stopped service or a PID/argv change during capture.

Review the private snapshot locally; do not upload unit contents or secrets.
Compare actual argv with configured ExecStart and approve the new agent list
separately. Preserve existing provider/account pools, MCP, `llm:`, `routing.env`,
environment files and unrelated drop-ins. Capture those files' checksums
privately if useful; never replace them as part of activation or rollback.
Confirm the rollback drop-in sorts after every existing ExecStart override.

## 3. Install the reviewed router service (after gates only)

Use a clean checkout at the independently approved SHA; do not blindly pull
a newer `main`. Adjust the unit's WorkingDirectory to that checkout. Back up
an existing router unit and `router.env` privately before replacing either.
Do not overwrite an existing token/config when updating.

For a new install, create `router.env` without displaying its contents:

```sh
umask 077
test ! -e "$HOME/.config/omnigent-deciderouter/router.env"
{
  echo HOST=127.0.0.1
  echo PORT=8790
  echo ROUTER_TIMEOUT_MS=8000
  echo DECIDER_MODELS=inception/mercury-decide:free
  printf 'ROUTER_API_KEY=%s\n' "$(openssl rand -hex 32)"
} > "$HOME/.config/omnigent-deciderouter/router.env"
chmod 600 "$HOME/.config/omnigent-deciderouter/router.env"
install -m 644 deploy/omnigent-deciderouter.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now omnigent-deciderouter.service
curl -fsS http://127.0.0.1:8790/healthz
```

Check that health reports **only free Mercury**. The 8000 ms router timeout
fits within Omnigent's 9 s budget. Verify loopback binding and authenticated
route selection before attaching Polly. Do not accept a heuristic response
as proof of live OpenRouter behavior.

For future updates, retain the previous router commit/unit/env snapshot,
validate and review the new SHA, then restart the router only in its approved
window. Router rollback restores that commit/unit/config and restarts only
the router. A new installation can instead be disabled and its newly created
unit removed; preserve the credential and all unrelated files.

## 4. Activate Polly (separately authorized, after gates only)

Re-capture the runtime if anything changed since the snapshot. Check that
`70-deciderouter.conf`, `router-client.env`, and the rollback override do not
already exist; stop if they do rather than overwrite an unrelated file.

- Edit **only** the `routing:` mapping in the approved Omnigent config
  (currently `~/.config/omnigent/server-polly.yaml`). Add or replace that
  mapping once; never append a duplicate YAML key:

  ```yaml
  routing:
    provider: external
    base_url: http://127.0.0.1:8790
    router_name: deciderouter_v1
    api_key: ${ROUTER_API_KEY}
  ```

- Preserve providers, accounts, MCP, built-in `llm:`, and all other settings.
  Capture a unified diff from `"$snapshot/server-polly.yaml"` to the edited
  config as `"$snapshot/routing.patch"`; review that it changes only routing.
  A `diff -u` exit of 1 means a diff was found, not failure.
- Copy only the `ROUTER_API_KEY=` line from `router.env` to the new
  `router-client.env` (0600), using file redirection without printing it.
  Add only this new `70-deciderouter.conf`:

  ```ini
  [Service]
  EnvironmentFile=%h/.config/omnigent-deciderouter/router-client.env
  ```

- Preserve the Codex allowlist: `gpt-6-luna` and `gpt-6.1-sol`, low/high
  effort only. Do not change workers/account pools or enable disabled models.
  Keep the service's decider chain free Mercury only.
- Confirm the service's pending ExecStart will load the intended config.
  When all sessions are idle and the new startup/agent list is approved,
  reload the user daemon and restart `omni-agent.service`.
- Verify new process argv, working directory, exact approved agent list and
  config flag, then real Polly `sys_advise_models` and worker policy behavior.
  Check bounded attempt errors/source for fallback. Do not treat health alone
  as authenticated Polly proof.

Use `deciderouter_v1`, never `task_v1`: Omnigent's built-in task menu for the
latter can introduce unauthorized options. Subscription harness turn/spawn
routing may still use the built-in judge; verify each intended entry point
separately. An external router failure can return empty advisory results.

## 5. Roll back the integration and actual startup

Restoring YAML alone is insufficient when pending drop-ins changed startup.
During the approved rollback window:

1. Reverse **only** the reviewed routing patch; preserve unrelated edits made
   since activation. Run the dry run first. If it conflicts, stop and reconcile
   only the routing mapping manually against the baseline.

   ```sh
   config="$HOME/.config/omnigent/server-polly.yaml"
   patch --reverse --dry-run "$config" "$snapshot/routing.patch"
   patch --reverse "$config" "$snapshot/routing.patch"
   ```

2. Remove only the integration-created `70-deciderouter.conf` and
   `router-client.env`. Do not remove any preexisting drop-in or change
   `routing.env`, providers, accounts or MCP.
3. Install the **prepared running-runtime override** at the highest priority:

   ```sh
   install -m 600 "$snapshot/zz-deciderouter-runtime-rollback.conf" \
     "$HOME/.config/systemd/user/omni-agent.service.d/zz-deciderouter-runtime-rollback.conf"
   systemctl --user daemon-reload
   systemctl --user restart omni-agent.service
   ```

4. Compare `/proc/<new MainPID>/cmdline` and working directory with
   `runtime.json`: exact original start flags and agent list must match.
   Confirm original config-flag presence/absence, previous routing behavior,
   and unrelated settings. Keep the runtime override in place: deleting it
   would reapply pending startup changes on the next restart. Retire it only
   after a separately approved startup reconciliation.
5. Disable the router if it was newly installed for this integration; if it
   preexisted, restore only its captured commit/unit/env instead.

The override resets ExecStart and working directory without deleting pending
drop-ins or changing their unrelated environment references. It cannot recover
a binary/agent file changed independently after capture; reconcile such changes
before restart. The baseline capture itself never reloads or restarts anything.
