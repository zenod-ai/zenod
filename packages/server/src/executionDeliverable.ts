import type { DeliverableManifest } from "./executionQueue.js";
import type { JourneyArtifact } from "./journeyStore.js";

/**
 * R1-T3 — deterministic retrieval of a completed execution's deliverable file(s).
 *
 * Two halves, both pure (I/O injected):
 *  1. resolve the deliverable manifest from the journey's execution_record artifacts
 *     (by executionId, "owner/repo#N" target, or a bare owner/repo#N in free text);
 *  2. fetch the live file bodies via the GitHub contents API at the manifest's
 *     headSha/branch — so it works for an UNMERGED (even draft) PR — and report the
 *     honest merge state alongside.
 */

export interface DeliverableFile {
  path: string;
  content?: string;
  error?: string;
}

export interface DeliverableFetchResult {
  reference: string;
  found: boolean;
  manifest?: DeliverableManifest;
  mergeState: string;
  files: DeliverableFile[];
  note?: string;
}

/** Injected GitHub contents reader: returns the decoded file body at `ref`, or throws. */
export type GithubContentsReader = (repo: string, path: string, ref?: string) => Promise<string>;

function manifestFromArtifact(a: JourneyArtifact): DeliverableManifest | undefined {
  if (a.kind !== "execution_record") return undefined;
  const d = (a.data as Record<string, unknown>).deliverable;
  return d && typeof d === "object" ? (d as DeliverableManifest) : undefined;
}

function executionIdFromArtifact(a: JourneyArtifact): string {
  return (
    (typeof a.data.executionId === "string" && a.data.executionId) ||
    a.artifactKey.replace(/^execution:/, "")
  );
}

function targetFromManifest(m: DeliverableManifest): string | undefined {
  return m.repo && typeof m.issue === "number" ? `${m.repo}#${m.issue}` : undefined;
}

/**
 * Find the deliverable manifest matching `reference` among execution_record artifacts.
 * Matches an executionId exactly, a fully-qualified "owner/repo#N" target, or a bare
 * owner/repo#N found anywhere in the reference string. Newest artifact wins on ties.
 */
export function resolveDeliverableManifest(
  artifacts: JourneyArtifact[],
  reference: string,
): DeliverableManifest | undefined {
  const ref = String(reference || "").trim();
  if (!ref) return undefined;
  const targetMatch = ref.match(/([^/\s#]+\/[^/\s#]+)#(\d+)/);
  const wantedTarget = targetMatch ? `${targetMatch[1]}#${targetMatch[2]}` : null;
  const records = artifacts.filter((a) => a.kind === "execution_record");
  // Prefer the most-recently-updated record when several match.
  const ordered = [...records].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  for (const a of ordered) {
    const manifest = manifestFromArtifact(a);
    if (!manifest) continue;
    if (executionIdFromArtifact(a) === ref) return manifest;
    if (wantedTarget && targetFromManifest(manifest) === wantedTarget) return manifest;
  }
  return undefined;
}

/** Honest one-line merge state for a manifest (mirrors the notification composer). */
export function deliverableMergeState(manifest: DeliverableManifest): string {
  if (manifest.merged === true) return "merged to main";
  if (manifest.prUrl) return "PR open — NOT merged yet";
  return "completed (no PR — filed artifact)";
}

/**
 * Fetch the live deliverable file bodies for a resolved manifest. Reads each path at
 * the manifest's headSha (falls back to branch) so unmerged/draft PRs still resolve.
 * A per-file read failure is captured on that file, never thrown, so a partial result
 * still returns. `maxFiles` bounds the fetch; overflow is noted, not silently dropped.
 */
export async function fetchDeliverableFiles(
  manifest: DeliverableManifest,
  read: GithubContentsReader,
  maxFiles = 10,
): Promise<DeliverableFetchResult> {
  const mergeState = deliverableMergeState(manifest);
  const target = targetFromManifest(manifest) ?? manifest.repo ?? "";
  const allPaths = manifest.paths ?? [];
  if (!manifest.repo || allPaths.length === 0) {
    return {
      reference: target,
      found: true,
      manifest,
      mergeState,
      files: [],
      note: manifest.repo ? "manifest carries no file paths" : "manifest has no repo to read from",
    };
  }
  const ref = manifest.headSha || manifest.branch || undefined;
  const paths = allPaths.slice(0, maxFiles);
  const files: DeliverableFile[] = [];
  for (const path of paths) {
    try {
      files.push({ path, content: await read(manifest.repo, path, ref) });
    } catch (err) {
      files.push({ path, error: (err as Error).message });
    }
  }
  const dropped = allPaths.length - paths.length;
  return {
    reference: target,
    found: true,
    manifest,
    mergeState,
    files,
    ...(dropped > 0 ? { note: `showing ${paths.length} of ${allPaths.length} files (${dropped} not fetched)` } : {}),
  };
}

/** Render a deliverable fetch result as human-facing text for a chat/tool reply. */
export function formatDeliverableResult(result: DeliverableFetchResult): string {
  if (!result.found || !result.manifest) {
    return `No deliverable found for "${result.reference}". It may not have completed yet, or the execution record carries no manifest.`;
  }
  const m = result.manifest;
  const head = [
    `Deliverable for ${result.reference || m.repo || "execution"} — ${result.mergeState}.`,
    m.prUrl ? `PR: ${m.prUrl}` : "",
    result.note ? `(${result.note})` : "",
  ].filter(Boolean).join("\n");
  if (result.files.length === 0) return head;
  const bodies = result.files
    .map((f) => (f.error ? `### ${f.path}\n(could not read: ${f.error})` : `### ${f.path}\n\n${f.content ?? ""}`))
    .join("\n\n");
  return `${head}\n\n${bodies}`;
}
