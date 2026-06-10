import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

/** Parsed .brain/config.yml — the machine end of the vault schema. */
export interface BrainConfig {
  schemaVersion: number;
  /** Controlled tag vocabulary; meaning pages may only use these. */
  tags: string[];
  /** Below this classification confidence, store() asks instead of filing. */
  confidenceThreshold: number;
}

export const CONFIG_PATH = ".brain/config.yml";

export class ConfigError extends Error {}

export async function loadBrainConfig(vaultPath: string): Promise<BrainConfig> {
  let raw: string;
  try {
    raw = await readFile(join(vaultPath, CONFIG_PATH), "utf8");
  } catch {
    throw new ConfigError(`missing ${CONFIG_PATH} — not a Zenod vault (run the schema migration first)`);
  }

  let data: unknown;
  try {
    data = parse(raw);
  } catch (err) {
    throw new ConfigError(`invalid YAML in ${CONFIG_PATH}: ${(err as Error).message}`);
  }

  if (typeof data !== "object" || data === null) {
    throw new ConfigError(`${CONFIG_PATH} must be a YAML mapping`);
  }
  const obj = data as Record<string, unknown>;

  const schemaVersion = obj.schema_version;
  if (schemaVersion !== 1) {
    throw new ConfigError(`unsupported schema_version: ${String(schemaVersion)} (expected 1)`);
  }

  const tags = obj.tags;
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string" && t.length > 0)) {
    throw new ConfigError(`${CONFIG_PATH}: tags must be a list of non-empty strings`);
  }

  const threshold = obj.confidence_threshold ?? 0.7;
  if (typeof threshold !== "number" || threshold < 0 || threshold > 1) {
    throw new ConfigError(`${CONFIG_PATH}: confidence_threshold must be a number between 0 and 1`);
  }

  return { schemaVersion: 1, tags, confidenceThreshold: threshold };
}
