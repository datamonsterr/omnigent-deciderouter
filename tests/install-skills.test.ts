import { expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installVerifiedSkill } from "../scripts/install-skills";

it("preserves an existing skill on hash mismatch and replaces it only after verification", () => {
  const work = mkdtempSync(join(import.meta.dir, ".installer-test-"));
  try {
    const source = join(work, "source");
    const target = join(work, "installed");
    mkdirSync(source);
    mkdirSync(target);
    writeFileSync(join(source, "SKILL.md"), "new instructions");
    writeFileSync(join(target, "SKILL.md"), "trusted instructions");
    writeFileSync(join(target, "existing.txt"), "keep me on failure");
    const skill = { name: "test", source: "test/test", commit: "pin", path: "test", sha256: "wrong" };
    expect(() => installVerifiedSkill(source, target, skill)).toThrow(/hash/i);
    expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe("trusted instructions");
    expect(readFileSync(join(target, "existing.txt"), "utf8")).toBe("keep me on failure");
    skill.sha256 = createHash("sha256").update("new instructions").digest("hex");
    installVerifiedSkill(source, target, skill);
    expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe("new instructions");
    expect(readdirSync(work).sort()).toEqual(["installed", "source"]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
