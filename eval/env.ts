// Credential loading for the live scripts. The key comes from the environment
// or from a dotenv-style file named by OPENROUTER_ENV_FILE; it is never printed.
import { existsSync, readFileSync } from "node:fs";

export function loadApiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY;
  const file = env.OPENROUTER_ENV_FILE;
  if (!file || !existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?OPENROUTER_API_KEY\s*=\s*(.*)$/.exec(line);
    if (match) return match[1]!.trim().replace(/^(['"])(.*)\1$/, "$2") || undefined;
  }
  return undefined;
}
