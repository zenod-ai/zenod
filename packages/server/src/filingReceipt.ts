import type { StoreResult } from "zenod";

/**
 * M-5 — the vault filing completion receipt. A background captureNote (see
 * engine.ts's captureNote) used to only console.info on completion — the user (and
 * any operator watching notifications) had no durable signal the save actually
 * landed. This is a pure function of the same StoreResult the engine already
 * produces, composed the same way execution/terminal notifications are: "Filed →
 * <page> ^<anchor> (<provider revision>[; optional Git history])".
 */
export function formatFilingReceipt(result: StoreResult): string {
  const anchorMatch = /#(\^[a-z0-9-]+)/i.exec(result.evidenceRef);
  const page = result.pagesTouched[0] || "(inbox)";
  const durableId = result.revision?.provider === "google_drive"
    ? `google_drive:${result.revision.id}${result.commitSha ? `; git:${result.commitSha.slice(0, 7)}` : ""}`
    : result.commitSha
      ? result.commitSha.slice(0, 7)
      : result.revision
        ? `${result.revision.provider}:${result.revision.id}`
        : "revision unavailable";
  return anchorMatch ? `Filed → ${page} ${anchorMatch[1]} (${durableId})` : `Filed → ${page} (${durableId})`;
}
