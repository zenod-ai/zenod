import type { VoiceArchiveResult } from "./voiceArchive.js";

type StoreFiling = "filed" | "uncertain" | "inbox" | "pending";

interface StoreResultLike {
  evidenceRef: string;
  pagesTouched: string[];
  commitSha: string;
  githubUrls: string[];
  filing: StoreFiling;
}

export interface StorageReceiptInput {
  storeResult?: unknown;
  archive?: VoiceArchiveResult | null;
  archiveError?: unknown;
  archiveUnavailableReason?: string | null;
  /** What kind of media was archived to Drive — labels the receipt line. */
  archiveLabel?: string;
  filingStatus?: "done" | "error" | "timeout" | null;
  filingError?: string;
}

function asStoreResult(value: unknown): StoreResultLike | null {
  const v = value as (Partial<StoreResultLike> & { question?: unknown }) | null | undefined;
  if (!v || typeof v !== "object") return null;
  if (typeof v.evidenceRef !== "string") return null;
  const filing = ["filed", "uncertain", "inbox", "pending"].includes(String(v.filing))
    ? v.filing as StoreFiling
    : typeof v.question === "string"
      ? "inbox"
      : "filed";
  return {
    evidenceRef: v.evidenceRef,
    pagesTouched: Array.isArray(v.pagesTouched) ? v.pagesTouched.filter((p): p is string => typeof p === "string") : [],
    commitSha: typeof v.commitSha === "string" ? v.commitSha : "",
    githubUrls: Array.isArray(v.githubUrls) ? v.githubUrls.filter((u): u is string => typeof u === "string") : [],
    filing,
  };
}

function driveLink(file: VoiceArchiveResult): string {
  return file.webViewLink || `https://drive.google.com/file/d/${file.fileId}/view`;
}

export function formatStorageReceipt(input: StorageReceiptInput): string | null {
  const stored = asStoreResult(input.storeResult);
  const archive = input.archive ?? null;
  const archiveError = input.archiveError instanceof Error ? input.archiveError.message : input.archiveError ? String(input.archiveError) : "";
  if (!stored && !archive && !archiveError && input.filingStatus !== "error") return null;

  const lines = ["Storage receipt"];
  if (stored) {
    if (stored.filing === "uncertain") {
      lines.push(`Saved — filed to ${stored.pagesTouched[0] ?? "the selected page"} with an open filing question logged in the page (review anytime).`);
    } else if (stored.filing === "inbox") {
      lines.push("Saved — filed to Inbox; the filing question is logged in the note.");
    } else {
      lines.push(stored.filing === "pending" ? "Filing pending." : "Saved.");
    }
    lines.push(`Vault evidence: ${stored.evidenceRef}`);
    lines.push(`Vault note(s): ${stored.pagesTouched.length ? stored.pagesTouched.join(", ") : "(inbox / no page returned)"}`);
    if (stored.commitSha) lines.push(`Vault commit: ${stored.commitSha}`);
    if (stored.githubUrls.length) {
      lines.push("Vault link(s):");
      for (const url of stored.githubUrls) lines.push(`- ${url}`);
    }
  } else if (input.filingStatus === "error") {
    lines.push(`Vault filing: failed${input.filingError ? ` — ${input.filingError}` : ""}`);
  } else if (input.filingStatus === "timeout") {
    lines.push("Vault filing: still processing; no final vault receipt yet.");
  }

  const archiveLabel = input.archiveLabel ?? "audio";
  if (archive) {
    lines.push(`Drive ${archiveLabel}: ${archive.name}`);
    lines.push(`Drive link: ${driveLink(archive)}`);
  } else if (archiveError) {
    lines.push(`Drive ${archiveLabel}: archive failed — ${archiveError}`);
  } else if (input.archive === null) {
    lines.push(`Drive ${archiveLabel}: not archived; ${input.archiveUnavailableReason ?? "Google Drive archive is not configured."}`);
  }

  return lines.join("\n");
}
