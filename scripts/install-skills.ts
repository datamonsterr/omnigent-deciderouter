// Installs the project-only skill bank (.agents/jev_skills) from the pinned
// commits in .agents/skills-manifest.json and verifies each SKILL.md hash.
// Usage: bun run skills:install
import { createHash } from "node:crypto";
import { cpSync, existsSync, renameSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { $ } from "bun";

export interface ManifestSkill {
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

export function installVerifiedSkill(source: string, target: string, skill: ManifestSkill): void {
  mkdirSync(dirname(target), { recursive: true });
  const stage = mkdtempSync(join(dirname(target), ".skill-stage-"));
  const candidate = join(stage, "candidate");
  const previous = join(stage, "previous");
  try {
    cpSync(source, candidate, { recursive: true });
    const skillFile = join(candidate, "SKILL.md");
    if (skill.patch?.startsWith("quote-description")) quoteDescription(skillFile);
    const digest = createHash("sha256").update(readFileSync(skillFile)).digest("hex");
    if (digest !== skill.sha256) throw new Error("Skill hash mismatch");
    const hadPrevious = existsSync(target);
    if (hadPrevious) renameSync(target, previous);
    try {
      renameSync(candidate, target);
    } catch (error) {
      if (hadPrevious) renameSync(previous, target);
      throw error;
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  mkdirSync(bank, { recursive: true });
  const work = mkdtempSync(join(root, ".skills-download-"));
  try {
    const archives = new Map<string, string>();
    for (const skill of manifest.skills) {
      const key = `${skill.source}@${skill.commit}`;
      if (!archives.has(key)) {
        const dir = join(work, String(archives.size));
        mkdirSync(dir);
        await $`gh repo clone ${skill.source} ${dir} -- --no-checkout --filter=blob:none`.quiet();
        await $`git -C ${dir} checkout --detach ${skill.commit}`.quiet();
        archives.set(key, dir);
      }
      const target = join(bank, skill.name);
      installVerifiedSkill(join(archives.get(key)!, skill.path), target, skill);
      console.log(`installed ${skill.name} <- ${key}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

}
