import { expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

it("honors explicit JEV_PATH and refuses arbitrary PATH binaries or unpinned runtimes", () => {
  const work = mkdtempSync(join(import.meta.dir, ".selector-test-"));
  try {
    const bin = join(work, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "jev-skill-selector"), "#!/bin/sh\necho UNTRUSTED_PATH_RUNTIME\n");
    chmodSync(join(bin, "jev-skill-selector"), 0o755);
    const unpinned = join(work, "unpinned");
    mkdirSync(unpinned);
    writeFileSync(join(unpinned, "index.ts"), 'console.log("UNTRUSTED_SOURCE");');
    for (const path of [join(work, "missing"), unpinned]) {
      const result = Bun.spawnSync(["bash", ".agents/skills/jev-skill-selector/run.sh", "--verify-runtime"], {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, JEV_PATH: path, PATH: bin + ":" + process.env.PATH },
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout.toString()).not.toContain("UNTRUSTED");
      expect(result.stderr.toString()).toContain("provenance");
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
