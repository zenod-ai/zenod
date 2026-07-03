import type { StoreResult } from "zenod";

/**
 * M-5 — the vault filing completion receipt. A background captureNote (see
 * engine.ts's captureNote) used to only console.info on completion — the user (and
 * any operator watching notifications) had no durable signal the commit actually
 * landed. This is a pure function of the same StoreResult the engine already
 * produces, composed the same way execution/terminal notifications are: "Filed →
 * <page> ^<anchor> (<sha>)".
 */
export function formatFilingReceipt(result: StoreResult): string {
  const anchorMatch = /#(\^[a-z0-9-]+)/i.exec(result.evidenceRef);
  const page = result.pagesTouched[0] || "(inbox)";
  const sha = result.commitSha ? result.commitSha.slice(0, 7) : result.commitSha;
  return anchorMatch ? `Filed → ${page} ${anchorMatch[1]} (${sha})` : `Filed → ${page} (${sha})`;
}
