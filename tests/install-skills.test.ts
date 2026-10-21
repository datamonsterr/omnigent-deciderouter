import { expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

it("keeps the installed path continuously available to concurrent readers during replacement", async () => {
  const work = mkdtempSync(join(import.meta.dir, ".installer-reader-"));
  const target = join(work, "installed");
  const stop = join(work, "stop");
  let observer: import("bun").Subprocess<"ignore", "pipe", "pipe"> | undefined;
  try {
    const source = join(work, "source");
    mkdirSync(source);
    mkdirSync(target);
    writeFileSync(join(source, "SKILL.md"), "verified instructions");
    writeFileSync(join(target, "SKILL.md"), "old instructions");
    observer = Bun.spawn(["bun", "-e", `
      const {existsSync}=require("node:fs");
      const [target,stop]=process.argv.slice(1);
      console.log("ready");
      let missing=0;
      while(!existsSync(stop)) { if(!existsSync(target)) missing++; }
      console.log(missing);
    `, target, stop], { stdout: "pipe", stderr: "pipe" });
    const reader = observer.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("ready");
    const skill = { name: "test", source: "test/test", commit: "pin", path: "test",
      sha256: createHash("sha256").update("verified instructions").digest("hex") };
    for (let iteration = 0; iteration < 100; iteration++) installVerifiedSkill(source, target, skill);
    writeFileSync(stop, "stop");
    let output = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      output += new TextDecoder().decode(chunk.value);
    }
    expect(await observer.exited).toBe(0);
    expect(Number(output.trim())).toBe(0);
  } finally {
    if (observer && !existsSync(stop)) writeFileSync(stop, "stop");
    if (observer) await observer.exited;
    rmSync(work, { recursive: true, force: true });
  }
}, 20_000);
