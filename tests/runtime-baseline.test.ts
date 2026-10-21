import { expect, it } from "bun:test";
import { runtimeOverride } from "../deploy/runtime-baseline";

it("restores the actual running start flags and agents rather than pending drop-in startup", () => {
  const unit = runtimeOverride(["/opt/venv/bin/python", "/opt/omnigent", "server", "--agent", "/agents/original", "--port", "6767"], "/home/operator");
  expect(unit).toContain("ExecStart=\nExecStart=");
  expect(unit).toContain('"/agents/original"');
  expect(unit).toContain('"--port" "6767"');
  expect(unit).not.toContain("--config");
  expect(unit).not.toContain("Environment=");
  expect(unit).not.toContain("EnvironmentFile=");
});

it("escapes systemd expansion and quoted path characters in captured argv", () => {
  const unit = runtimeOverride(["/opt/bin/runtime", 'a$b%c"d\\e'], "/work dir");
  expect(unit).toContain('"a$$b%%c\\"d\\\\e"');
  expect(unit).toContain('WorkingDirectory=/work dir\n');
  expect(() => runtimeOverride([], "/work")).toThrow();
  expect(() => runtimeOverride(["relative"], "/work")).toThrow();
});
