import { copyFileSync, existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

function unitQuote(value: string, command = false): string {
  const literal = value.replaceAll("%", "%%");
  return JSON.stringify(command ? literal.replaceAll("$", () => "$$") : literal);
}

/** A later drop-in overrides pending ExecStart changes without editing them. */
export function runtimeOverride(argv: string[], cwd: string): string {
  if (!argv.length || !isAbsolute(argv[0]!) || !isAbsolute(cwd)) throw new Error("Absolute executable and working directory required");
  if (/[\r\n]/.test(cwd) || cwd.trim() !== cwd) throw new Error("Working directory cannot contain line breaks or boundary whitespace");
  return "[Service]\nWorkingDirectory=" + cwd.replaceAll("%", "%%") +
    "\nExecStart=\nExecStart=" + argv.map((arg) => unitQuote(arg, true)).join(" ") + "\n";
}

if (import.meta.main) {
  process.umask(0o077);
  const destination = process.argv[2];
  if (!destination) throw new Error("Usage: bun run deploy/runtime-baseline.ts <new-private-snapshot-directory>");
  const snapshot = resolve(destination);
  if (existsSync(snapshot)) throw new Error("Snapshot already exists; never overwrite a baseline");
  const service = "omni-agent.service";
  function show(property: string): string {
    const result = Bun.spawnSync(["systemctl", "--user", "show", service, "-p", property, "--value"]);
    if (result.exitCode !== 0) throw new Error("Cannot inspect user service; configure XDG_RUNTIME_DIR and user bus");
    return result.stdout.toString().trim();
  }
  const pid = show("MainPID");
  if (!/^[1-9]\d*$/.test(pid)) throw new Error("Service is not running");
  const proc = "/proc/" + pid;
  const argv = readFileSync(join(proc, "cmdline"), "utf8").split("\0").slice(0, -1);
  const cwd = readlinkSync(join(proc, "cwd"));
  const override = runtimeOverride(argv, cwd);
  const baseline = {
    captured_at: new Date().toISOString(), pid, argv, cwd,
    executable: readlinkSync(join(proc, "exe")),
    configured_exec_start: show("ExecStart"),
    fragment: show("FragmentPath"), dropins: show("DropInPaths"),
    environment_files: show("EnvironmentFiles"),
    agents: argv.flatMap((arg, i) => arg === "--agent" ? [argv[i + 1]] : []),
    config: argv.includes("--config") ? argv[argv.indexOf("--config") + 1] : null,
  };
  mkdirSync(snapshot, { mode: 0o700 });
  writeFileSync(join(snapshot, "runtime.json"), JSON.stringify(baseline, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(join(snapshot, "zz-deciderouter-runtime-rollback.conf"), override, { mode: 0o600 });
  const configured = Bun.spawnSync(["systemctl", "--user", "cat", service]);
  if (configured.exitCode !== 0) throw new Error("Cannot capture configured service");
  writeFileSync(join(snapshot, "configured-unit.txt"), configured.stdout, { mode: 0o600 });
  const config = join(process.env.HOME!, ".config/omnigent/server-polly.yaml");
  if (existsSync(config)) copyFileSync(config, join(snapshot, "server-polly.yaml"));
  const after = show("MainPID");
  if (after !== pid || readFileSync(join(proc, "cmdline"), "utf8").split("\0").slice(0, -1).join("\0") !== argv.join("\0")) {
    throw new Error("Runtime changed during capture; discard snapshot and retry");
  }
  console.log(JSON.stringify({ snapshot, pid, agent_count: baseline.agents.length, has_config_flag: baseline.config !== null }));
}
