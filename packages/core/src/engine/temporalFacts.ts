import { createHash } from "node:crypto";
import type { MemoryEntry } from "../types.js";
import { parseNote, serializeNote } from "../vault/frontmatter.js";
import type { VaultSourceRef } from "../vault/repository.js";

/** Optional classifier extension. Every substantive value is an exact source quote. */
export interface FactProposal {
  key: string;
  statement: string;
  effectiveDate: string | null;
  effectiveDateQuote: string | null;
  correctionQuote: string | null;
  supersedesQuotes: string[];
  verificationQuote: string | null;
}
export interface MemoryFact extends FactProposal {
  id: string;
  evidenceRef: string;
  /** When the evidence was captured, never an inferred effective date. */
  evidenceDate: string | null;
  origin: "synthetic" | "user_report";
  supersedes: string[];
  unresolvedCorrection: boolean;
}
export interface FactReadInput { path: string; key?: string | undefined; asOf?: string | undefined }
export interface FactView {
  path: string;
  key?: string;
  asOf: string;
  mode: "current" | "historical";
  scope: "selected-note-facts";
  complete: boolean;
  legacy: boolean;
  facts: Array<MemoryFact & { status: "active" | "superseded" | "conflict" | "undated" | "future" | "unsupported"; source?: VaultSourceRef }>;
  warnings: string[];
}
const REF = /^Log\/\d{4}-\d{2}-\d{2}\.md#\^e-[a-f0-9]{6}$/;
const CORRECTION = /\b(correct(?:ion|ed|ing)?|replaces?|supersedes?|instead|no longer)\b/i;
const UNCERTAIN_CORRECTION = /\b(do not|don't|not (?:a )?correction|should not|never|may|might|could|consider|hypothetical|if|plan to|need to|will)\b/i;
function explicitCorrection(quote: string, statement: string): boolean {
  return quote.includes(statement) && CORRECTION.test(quote) && !UNCERTAIN_CORRECTION.test(quote);
}
function explicitEffectiveDate(quote: string | null, statement: string, date: string): boolean {
  if (!quote || !quote.includes(statement)) return false;
  // The effective marker must bind directly to THIS statement, not another date elsewhere in the capture.
  const suffix = quote.slice(quote.lastIndexOf(statement) + statement.length);
  return new RegExp(`^[\\s"'.,;:()—-]*(?:effective(?: date)?|as of|valid from|since|from)\\s*:?\\s*${date}\\b`, "i").test(suffix);
}
function verificationScope(quote: string | null, evidence: MemoryEntry): string | null {
  if (!quote || quote.length > 1600 || !evidence.content.includes(quote)
    || !/\b(verified|tested|checked|reproduced)\b/i.test(quote)
    || /\b(not|never|unverified|untested|will|plan|might|could|if)\b|(?:didn't|haven't|hasn't)/i.test(quote)
    || !/\b(local|staging|production|environment|version|build|commit|sha)\b/i.test(quote)) return null;
  const date = quote.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  return validFactDate(date) && validFactDate(evidence.capturedAt.slice(0, 10)) && date <= evidence.capturedAt.slice(0, 10) ? quote : null;
}
const SYNTHETIC = /\bsynthetic(?: test)?(?: data| fixture)?\b|\btest fixture\b/i;
export function validFactDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function factId(ref: string, key: string, statement: string): string {
  return createHash("sha256").update(JSON.stringify([ref, key, statement])).digest("hex").slice(0, 20);
}
/** Legacy notes remain valid; malformed new records never become evidence. */
export function parseMemoryFacts(value: unknown): MemoryFact[] {
  if (!Array.isArray(value)) return [];
  return value.filter((fact): fact is MemoryFact => !!fact && typeof fact === "object"
    && typeof fact.key === "string" && fact.key.length > 0 && fact.key.length <= 160
    && typeof fact.statement === "string" && fact.statement.length > 0 && fact.statement.length <= 1600
    && typeof fact.evidenceRef === "string" && REF.test(fact.evidenceRef)
    && fact.id === factId(fact.evidenceRef, fact.key, fact.statement)
    && (fact.effectiveDate === null || validFactDate(fact.effectiveDate))
    && (fact.effectiveDateQuote === null || typeof fact.effectiveDateQuote === "string")
    && (fact.evidenceDate === null || typeof fact.evidenceDate === "string")
    && (fact.origin === "synthetic" || fact.origin === "user_report")
    && (fact.correctionQuote === null || typeof fact.correctionQuote === "string")
    && (fact.verificationQuote === null || typeof fact.verificationQuote === "string")
    && Array.isArray(fact.supersedesQuotes) && fact.supersedesQuotes.every((v: unknown) => typeof v === "string")
    && Array.isArray(fact.supersedes) && fact.supersedes.every((v: unknown) => typeof v === "string")
    && typeof fact.unresolvedCorrection === "boolean");
}

/** Append source-qualified records to the existing note. Never edit old records or body lines. */
export function appendMemoryFacts(raw: string, original: string | null, proposals: FactProposal[], evidence: MemoryEntry, assignedEvidence = evidence.content): string {
  const next = parseNote(raw);
  if (!next.frontmatter) return raw;
  const priorValue = original ? parseNote(original).frontmatter?.memoryFacts : undefined;
  const prior = parseMemoryFacts(priorValue);
  if (priorValue !== undefined && !Array.isArray(priorValue)) {
    // A pre-existing custom field is not an invitation to destroy user metadata.
    next.frontmatter.memoryFacts = priorValue;
    return serializeNote(next.frontmatter, next.body);
  }
  // The composer cannot invent records, including for a newly created note.
  delete next.frontmatter.memoryFacts;
  const additions: MemoryFact[] = [];
  for (const proposal of proposals.slice(0, 24)) {
    if (!proposal.key?.trim() || proposal.key.length > 160 || !proposal.statement?.trim()
      || proposal.statement.length > 1600 || !assignedEvidence.includes(proposal.statement)) continue;
    const key = proposal.key.trim().toLowerCase();
    const id = factId(evidence.evidenceRef, key, proposal.statement);
    if ([...prior, ...additions].some(fact => fact.id === id)) continue;
    const correctionQuote = proposal.correctionQuote && proposal.correctionQuote.length <= 2400
      && assignedEvidence.includes(proposal.correctionQuote) && explicitCorrection(proposal.correctionQuote, proposal.statement)
      ? proposal.correctionQuote : null;
    const effectiveDateQuote = proposal.effectiveDateQuote && proposal.effectiveDateQuote.length <= 2400
      && assignedEvidence.includes(proposal.effectiveDateQuote) ? proposal.effectiveDateQuote : null;
    const effectiveDate = validFactDate(proposal.effectiveDate) && explicitEffectiveDate(effectiveDateQuote, proposal.statement, proposal.effectiveDate) ? proposal.effectiveDate : null;
    const origin = SYNTHETIC.test(evidence.content) || evidence.source === "selftest" ? "synthetic" : "user_report";
    const requested = (proposal.supersedesQuotes ?? []).filter(quote => typeof quote === "string" && quote.length > 0).slice(0, 24);
    const supersedes: string[] = [];
    let unresolvedCorrection = Boolean(proposal.correctionQuote || requested.length);
    if (correctionQuote && requested.length) {
      unresolvedCorrection = false;
      for (const quote of requested) {
        // Both replacement intent and its exact old statement must occur in new evidence.
        const matches = prior.filter(fact => fact.key === key && fact.statement === quote && fact.origin === origin);
        if (!correctionQuote.includes(quote) || matches.length !== 1
          || (effectiveDate && matches[0]!.effectiveDate && effectiveDate < matches[0]!.effectiveDate!)) {
          unresolvedCorrection = true;
        } else supersedes.push(matches[0]!.id);
      }
    }
    // An ambiguous multi-target correction must not partially suppress old facts.
    if (unresolvedCorrection) supersedes.length = 0;
    additions.push({ id, key, statement: proposal.statement, evidenceRef: evidence.evidenceRef,
      evidenceDate: Number.isNaN(Date.parse(evidence.capturedAt)) ? null : evidence.capturedAt,
      effectiveDate, effectiveDateQuote: effectiveDate ? effectiveDateQuote : null, correctionQuote, supersedesQuotes: requested, supersedes, unresolvedCorrection, origin,
      verificationQuote: verificationScope(proposal.verificationQuote, { ...evidence, content: assignedEvidence }) });
  }
  // Preserve even legacy/unknown metadata records verbatim; only validated records enter projection.
  const retained = Array.isArray(priorValue) ? priorValue : [];
  if (retained.length || additions.length) next.frontmatter.memoryFacts = [...retained, ...additions];
  const annotations = additions.map(fact => {
    const citation = `[[${fact.evidenceRef.replace(/^Log\//, "").replace(".md#", "#")}]]`;
    return `- ${fact.key}: ${JSON.stringify(fact.statement)} — ${fact.origin}; effective ${fact.effectiveDate ?? "unknown"}; ${fact.supersedes.length ? "explicit correction of " + fact.supersedes.join(", ") : fact.unresolvedCorrection ? "correction target unresolved; conflict retained" : "reported evidence, not live verification"}. (${citation})`;
  });
  return serializeNote(next.frontmatter, next.body + (annotations.length ? `\n\n## Evidence-qualified updates\n\n${annotations.join("\n")}\n` : ""));
}

/** Re-read immutable evidence at query time; persisted annotations alone cannot support a claim. */
export async function projectFacts(
  input: FactReadInput, metadata: unknown, now: Date,
  readEvidence: (ref: string) => Promise<MemoryEntry>,
): Promise<FactView> {
  if (input.asOf !== undefined && !validFactDate(input.asOf)) throw new Error("asOf must be a real YYYY-MM-DD date");
  const all = parseMemoryFacts(metadata);
  const selected = all.filter(fact => input.key === undefined || fact.key === input.key.trim().toLowerCase());
  let bytes = 0;
  const bounded: MemoryFact[] = [];
  for (const fact of selected) {
    bytes += JSON.stringify(fact).length;
    if (bounded.length >= 32 || bytes > 24000) break;
    bounded.push(fact);
  }
  const malformed = metadata !== undefined && (!Array.isArray(metadata) || metadata.length !== all.length);
  const view: FactView = { path: input.path, ...(input.key !== undefined ? { key: input.key.trim().toLowerCase() } : {}), asOf: input.asOf ?? now.toISOString().slice(0, 10), mode: input.asOf ? "historical" : "current",
    scope: "selected-note-facts", complete: bounded.length === selected.length && !malformed, legacy: all.length === 0, facts: [], warnings: [] };
  const entries = new Map<string, MemoryEntry | null>();
  for (const fact of bounded) {
    if (!entries.has(fact.evidenceRef)) {
      try { entries.set(fact.evidenceRef, await readEvidence(fact.evidenceRef)); } catch { entries.set(fact.evidenceRef, null); }
    }
    const entry = entries.get(fact.evidenceRef);
    const supported = entry && entry.content.includes(fact.statement)
      && (!fact.effectiveDate || (fact.effectiveDateQuote && entry.content.includes(fact.effectiveDateQuote) && explicitEffectiveDate(fact.effectiveDateQuote, fact.statement, fact.effectiveDate)))
      && (!fact.correctionQuote || entry.content.includes(fact.correctionQuote))
      && (!fact.verificationQuote || verificationScope(fact.verificationQuote, entry));
    const origin = entry && (SYNTHETIC.test(entry.content) || entry.source === "selftest") ? "synthetic" : "user_report";
    view.facts.push({ ...fact, origin, evidenceDate: entry && !Number.isNaN(Date.parse(entry.capturedAt)) ? entry.capturedAt : null,
      status: !supported ? "unsupported" : fact.effectiveDate && fact.effectiveDate > view.asOf ? "future" : view.mode === "historical" && !fact.effectiveDate ? "undated" : "active",
      ...(supported ? { source: { path: entry.evidenceRef, url: entry.url, provider: entry.provider,
        ...(entry.revisionId ? { revisionId: entry.revisionId } : {}), ...(entry.githubUrl ? { githubUrl: entry.githubUrl } : {}) } } : {}) });
  }
  const eligible = view.facts.filter(fact => fact.status === "active");
  for (const fact of eligible) {
    // Revalidate relation semantics, not just a model-authored ID in frontmatter.
    for (const target of eligible) {
      if (fact.unresolvedCorrection || !fact.supersedes.includes(target.id) || fact.id === target.id
        || fact.key !== target.key || fact.origin !== target.origin || !fact.correctionQuote || !explicitCorrection(fact.correctionQuote, fact.statement)
        || !fact.correctionQuote.includes(fact.statement) || !fact.correctionQuote.includes(target.statement) || !fact.supersedesQuotes.includes(target.statement)
        || (fact.effectiveDate && target.effectiveDate && fact.effectiveDate < target.effectiveDate)) continue;
      target.status = "superseded";
    }
  }
  for (const fact of eligible.filter(fact => fact.status === "active")) {
    if (fact.unresolvedCorrection || eligible.some(other => other.id !== fact.id && other.status !== "superseded"
      && other.key === fact.key && other.origin === fact.origin && other.statement !== fact.statement)) fact.status = "conflict";
  }
  view.warnings.push("Memory reports are not live verification. Verification quotes describe only the stated test, environment and date; no deployment or present health is inferred. An absent fix record never proves that a bug remains unfixed.");
  if (view.mode === "historical") view.warnings.push("This reconstructs explicitly stated effective dates using evidence available now; it does not claim these facts were known at that earlier time.");
  if (view.legacy) view.warnings.push("Legacy or unstructured note: effective dates, correction relations and verification scope are unknown. Read its original evidence; do not assume its prose is current.");
  if (!view.complete) view.warnings.push("Partial: the 32-record / 24,000-character metadata budget was exceeded or malformed records exist. Narrow to an exact key, or read the note metadata and original evidence directly. This projection cannot establish a complete current state or absence.");
  if (view.facts.some(fact => fact.status === "unsupported")) view.warnings.push("Some records lack readable matching immutable evidence and cannot support an answer.");
  if (view.facts.some(fact => fact.status === "undated")) view.warnings.push("Undated claims cannot establish the requested historical state.");
  return view;
}

/** Material claims come from source quotes, not unconstrained model prose. */
export function renderFactViews(views: FactView[]): string {
  return [...new Map(views.map(view => [JSON.stringify(view), view])).values()].map(view => {
    const lines = [`${view.mode === "historical" ? "Historical effective state as of" : "Latest supported memory reports as of"} ${view.asOf} (${view.path}${view.key ? `; key ${view.key}` : ""}${view.complete ? "" : "; partial"}):`];
    const visible = view.facts.filter(fact => fact.status !== "superseded" && fact.status !== "future");
    if (!visible.length) lines.push("No supported active claim established in this selected note/key scope. This is not proof of absence elsewhere.");
    for (const fact of visible) {
      if (fact.status === "unsupported") { lines.push(`- ${fact.key}: unsupported record; original evidence unavailable or mismatched.`); continue; }
      lines.push(`- ${fact.status === "conflict" ? "Unresolved conflict — " : fact.status === "undated" ? "Effective date unknown — " : ""}${fact.origin === "synthetic" ? "Synthetic fixture" : "User report"}: ${JSON.stringify(fact.statement)} [${fact.evidenceRef}](${fact.source!.url}). Effective: ${fact.effectiveDate ?? "unknown"}; evidence captured: ${fact.evidenceDate ?? "unknown"}.${fact.verificationQuote ? ` Reported verification scope: ${JSON.stringify(fact.verificationQuote)}.` : " Verification scope: unknown."}`);
    }
    lines.push(...view.warnings);
    return lines.join("\n");
  }).join("\n\n");
}
