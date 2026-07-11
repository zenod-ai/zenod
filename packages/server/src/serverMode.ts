export type ServerMode = "callisthenes" | "phylax" | "ring" | "herald" | "zenod" | "legacy";

export function resolveServerMode(env: NodeJS.ProcessEnv, agentName: string): ServerMode {
  if (env.ZENOD_UNIT?.trim().toLowerCase() === "callisthenes") return "callisthenes";
  if (env.ZENOD_UNIT?.trim().toLowerCase() === "phylax") return "phylax";
  if (env.ZENOD_UNIT?.trim().toLowerCase() === "ring") return "ring";
  if (env.ZENOD_UNIT?.trim().toLowerCase() === "herald") return "herald";
  if (!env.AGENT || agentName === "zenod") return "zenod";
  return "legacy";
}
