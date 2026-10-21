// Installs the project-only skill bank (.agents/jev_skills) from the pinned
// commits in .agents/skills-manifest.json and verifies each SKILL.md hash.
// Usage: bun run skills:install
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

interface ManifestSkill {
  name: string;
  source: string;
  commit: string;
  path: string;
  patch?: string;
  sha256: string;
}

const root = join(import.meta.dir, "..");
const bank = join(root, ".agents", "jev_skills");
const manifest = JSON.parse(readFileSync(join(root, ".agents", "skills-manifest.json"), "utf8")) as {
  skills: ManifestSkill[];
};

function quoteDescription(skillFile: string): void {
  const lines = readFileSync(skillFile, "utf8").split("\n");
  const index = lines.findIndex((line) => line.startsWith("description: ") && !line.startsWith('description: "'));
  if (index === -1) return;
  lines[index] = `description: ${JSON.stringify(lines[index]!.slice("description: ".length))}`;
  writeFileSync(skillFile, lines.join("\n"));
}

mkdirSync(bank, { recursive: true });
const work = mkdtempSync(join(root, ".skills-download-"));
let failures = 0;
try {
  const archives = new Map<string, string>();
  for (const skill of manifest.skills) {
    const key = `${skill.source}@${skill.commit}`;
    if (!archives.has(key)) {
      const dir = join(work, String(archives.size));
      mkdirSync(dir);
      const url = `https://codeload.github.com/${skill.source}/tar.gz/${skill.commit}`;
      await $`curl -fsSL ${url} | tar -xz -C ${dir} --strip-components=1`;
      archives.set(key, dir);
    }
    const target = join(bank, skill.name);
    rmSync(target, { recursive: true, force: true });
    cpSync(join(archives.get(key)!, skill.path), target, { recursive: true });
    const skillFile = join(target, "SKILL.md");
    if (skill.patch?.startsWith("quote-description")) quoteDescription(skillFile);
    const digest = createHash("sha256").update(readFileSync(skillFile)).digest("hex");
    if (digest !== skill.sha256) failures++;
    console.log(`${digest === skill.sha256 ? "installed" : "HASH MISMATCH"} ${skill.name} <- ${key}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
