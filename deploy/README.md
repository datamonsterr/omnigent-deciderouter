# Local service install, rollback and Polly integration

This router runs as a `systemd --user` service on the same host as the
Omnigent server (`omni-agent.service`). Nothing here publishes an image or
deploys anywhere else: CI only builds and smoke-tests the Docker image.

The steps are split into two stages:

1. **Install the router service** — safe; it does not touch Omnigent.
2. **Activate Polly integration** — edits the Omnigent server config and
   restarts `omni-agent.service`. Read [Activation risks](#activation-risks)
   first.

## 1. Install the router service

```sh
# Code: a clean checkout of main (no local edits).
git -C ~/dev/omnigent-deciderouter fetch origin
git -C ~/dev/omnigent-deciderouter checkout main
git -C ~/dev/omnigent-deciderouter pull --ff-only
cd ~/dev/omnigent-deciderouter
bun install --frozen-lockfile
bun run check            # typecheck + tests + build
bun run check:models     # decider models still exist in the live catalog

# Secrets: ~/.config/omnigent-deciderouter/openrouter.env (0600) holds
# OPENROUTER_API_KEY=... and nothing else. Create router.env next to it.
umask 077
cat > ~/.config/omnigent-deciderouter/router.env <<EOF
HOST=127.0.0.1
PORT=8790
ROUTER_TIMEOUT_MS=8000
ROUTER_API_KEY=$(openssl rand -hex 32)
EOF
chmod 600 ~/.config/omnigent-deciderouter/*.env

# Service
install -m 644 deploy/omnigent-deciderouter.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now omnigent-deciderouter.service

# Verify
systemctl --user status omnigent-deciderouter.service --no-pager
curl -s http://127.0.0.1:8790/healthz
OPENROUTER_ENV_FILE=~/.config/omnigent-deciderouter/openrouter.env ./eval/probe.sh
```

Port 8790 is used because 8080 and 8787 are already taken on this host
(`ss -ltn`). `ROUTER_TIMEOUT_MS=8000` stays under Omnigent's 9 s per-call
budget for `routes:select`, so the router answers (via its heuristic) before
Omnigent gives up.

### Update

```sh
cd ~/dev/omnigent-deciderouter
git rev-parse HEAD > ~/.config/omnigent-deciderouter/previous-commit
git pull --ff-only && bun install --frozen-lockfile && bun run check
systemctl --user restart omnigent-deciderouter.service
curl -s http://127.0.0.1:8790/healthz
```

### Roll back the router

```sh
cd ~/dev/omnigent-deciderouter
git checkout "$(cat ~/.config/omnigent-deciderouter/previous-commit)"
bun install --frozen-lockfile
systemctl --user restart omnigent-deciderouter.service
# Remove completely:
systemctl --user disable --now omnigent-deciderouter.service
rm ~/.config/systemd/user/omnigent-deciderouter.service
systemctl --user daemon-reload
```

## 2. Activate Polly integration (not done by this PR)

The running `omni-agent.service` reads its routing provider from the file
passed with `--config` in its drop-ins:
`/home/dat/.config/omnigent/server-polly.yaml`. Today that file has only an
`llm:` block (the built-in judge on `openrouter/liquid/lfm-2.5-2.6b:free`)
and no `routing:` block. Activation adds a `routing:` block next to it and
leaves every other setting alone.

```sh
# Back up the files that change.
cp -a ~/.config/omnigent/server-polly.yaml ~/.config/omnigent/server-polly.yaml.bak-deciderouter

# Give omni-agent the router token without editing routing.env.
umask 077
grep '^ROUTER_API_KEY=' ~/.config/omnigent-deciderouter/router.env \
  > ~/.config/omnigent-deciderouter/router-client.env
mkdir -p ~/.config/systemd/user/omni-agent.service.d
cat > ~/.config/systemd/user/omni-agent.service.d/70-deciderouter.conf <<'EOF'
[Service]
EnvironmentFile=%h/.config/omnigent-deciderouter/router-client.env
EOF

# Append the routing block (see examples/omnigent-config.yaml).
cat >> ~/.config/omnigent/server-polly.yaml <<'EOF'
routing:
  provider: external
  base_url: http://127.0.0.1:8790
  router_name: deciderouter_v1
  api_key: ${ROUTER_API_KEY}
EOF

systemctl --user daemon-reload
systemctl --user restart omni-agent.service   # see risks below first
journalctl --user -u omni-agent.service -n 100 --no-pager | grep -i routing
```

`router_name` must not be `task_v1`: Omnigent injects its built-in task_v1
arm menu (other model ids) into `route_options` only for that name, which
would offer models outside the Codex policy.

### What changes after activation

- `sys_advise_models` (Polly's pre-fan-out model advice) uses the external
  router whenever one is configured (`backends_from_caps(caps).any()`), so
  Polly's worker recommendations come from this service.
- Turn and spawn routing for subscription harnesses (codex-native,
  antigravity-native, opencode-native, claude-native) is not gateway-backed, so
  Omnigent keeps using the built-in `llm:` judge there. The external router is
  only preferred for AI-Gateway-backed harnesses.
- If the router answers with HTTP 4xx/5xx, Omnigent logs
  `ExternalRoutingClient: routes:select returned ...` and the advice comes back
  empty. Some "not enabled" error texts latch the client off until the next
  restart.

### Roll back the integration

```sh
cp -a ~/.config/omnigent/server-polly.yaml.bak-deciderouter ~/.config/omnigent/server-polly.yaml
rm ~/.config/systemd/user/omni-agent.service.d/70-deciderouter.conf
systemctl --user daemon-reload
systemctl --user restart omni-agent.service
```

## Activation risks

- **The restart changes the agent list and config.** Checked on 2026-10-21:
  the running omni-agent process (started 01:21) uses the base unit's
  `ExecStart` — `conductor-codex-1..5`, `agy-acc1..4`, `planner-codex`, and
  **no `--config`**, so it has neither `server-polly.yaml` nor Polly loaded.
  The drop-ins were written later (`50-polly.conf`, `60-stitch-env.conf`,
  `65-custom-agents.conf` at 13:56). Any restart, including this one, switches
  to the `65-custom-agents.conf` list (`codex-1..5`, `agy-1..5`, `planner`,
  `conductor`, `pr-fixer`, `pr-merger`, `polly`, `polly-codex`, …) and loads
  `--config server-polly.yaml` for the first time. Check
  `systemctl --user cat omni-agent.service` and the running command line
  (`ps -o args= -p "$(systemctl --user show -p MainPID --value omni-agent.service)"`)
  before restarting, and schedule it when no sessions are running.
- **Keep unrelated settings.** Do not edit `routing.env`, `env`, providers,
  account pools, MCP or other drop-ins. The steps above only append a
  `routing:` block and add one new drop-in plus one new env file.
- **Advice depends on this service.** If the router is down, Polly gets no
  `sys_advise_models` recommendation (Polly's prompt treats it as advisory).
  Keep the router service enabled before activating.
