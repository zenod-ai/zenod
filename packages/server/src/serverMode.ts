export type ServerMode = "callisthenes" | "ring" | "zenod" | "legacy";

export function resolveServerMode(env: NodeJS.ProcessEnv, agentName: string): ServerMode {
  if (env.ZENOD_UNIT?.trim().toLowerCase() === "callisthenes") return "callisthenes";
  if (env.ZENOD_UNIT?.trim().toLowerCase() === "ring") return "ring";
  if (!env.AGENT || agentName === "zenod") return "zenod";
  return "legacy";
}
