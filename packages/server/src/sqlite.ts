import { openSqlite } from "@zenod/mcp-chassis";

export const ZENOD_SQLITE_BUSY_TIMEOUT_MS = 30_000;

export function openZenodSqlite(path: string) {
  return openSqlite(path, ZENOD_SQLITE_BUSY_TIMEOUT_MS);
}
