// Validates the configured decider chain against the live OpenRouter catalog:
// every model must exist, decisions models must declare the `decisions` output
// modality, and chat models must not. Public endpoints only; no key needed.
import { loadConfig } from "../src/config";
import { isDecisionModel } from "../src/openrouter";

interface CatalogModel {
  id: string;
  architecture?: { output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
}

const base = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai").replace(/\/+$/, "");

async function listModels(query = ""): Promise<CatalogModel[]> {
  const res = await fetch(`${base}/api/v1/models${query}`);
  if (!res.ok) throw new Error(`GET /api/v1/models${query} returned HTTP ${res.status}`);
  const body = (await res.json()) as { data?: CatalogModel[] };
  if (!Array.isArray(body.data)) throw new Error(`GET /api/v1/models${query} returned no data array`);
  return body.data;
}

const config = loadConfig();
const [decisions, chat] = await Promise.all([listModels("?output_modalities=decisions"), listModels()]);
const byId = new Map([...chat, ...decisions].map((m) => [m.id, m]));
const decisionIds = new Set(decisions.map((m) => m.id));

let failures = 0;
for (const model of config.deciderModels) {
  const entry = byId.get(model);
  const viaDecisions = isDecisionModel(model, config);
  const transport = viaDecisions ? "decisions" : "chat";
  let status = "ok";
  if (!entry) status = "MISSING from catalog";
  else if (viaDecisions && !decisionIds.has(model)) status = "classified decisions but catalog has no decisions modality";
  else if (!viaDecisions && decisionIds.has(model)) status = "decisions-only model would be sent to chat (add to DECISIONS_MODELS)";
  if (status !== "ok") failures++;
  const price = entry ? `prompt=${entry.pricing?.prompt ?? "?"} completion=${entry.pricing?.completion ?? "?"}` : "";
  console.log(`${status === "ok" ? "PASS" : "FAIL"} ${model} transport=${transport} ${price} ${status === "ok" ? "" : status}`.trim());
}

const unrecognized = decisions.map((m) => m.id).filter((id) => !isDecisionModel(id, config));
console.log(`decisions catalog: ${decisions.length} models; need DECISIONS_MODELS to use: ${unrecognized.join(", ") || "none"}`);
process.exit(failures ? 1 : 0);
