import { createHash } from "node:crypto";
import type { MemoryEntry } from "../types.js";
import { parseNote, serializeNote } from "../vault/frontmatter.js";
import { pageRevision } from "../vault/pages.js";
import type { BranchContextPacket } from "./meaningNotes.js";
import { appendMemoryFacts, parseMemoryFacts, type FactProposal } from "./temporalFacts.js";
import { resolveRawSourceQuote, type SourceQuoteRun } from "./sourceQuote.js";

export interface ReconciliationSource { id: string; start: number; end: number; text: string }
export interface ReconciliationStatement { id: string; text: string; sectionId: string; factKey: string | null }
export interface ReconciliationIdea {id:string;topic:string;sourceIds:string[];sourcePartial?:boolean;omittedSourceCount?:number;priorFailure?:string}
export interface ReconciliationInput {
  path: string; revision: string | null; contextPartial: boolean;
  statements: ReconciliationStatement[]; sources: ReconciliationSource[]; ideas:ReconciliationIdea[];
}
export interface ReconciliationOperation {
  kind: "add" | "link_source" | "supersede" | "conflict" | "clarify";
  ideaIds?: string[];
  /** Legacy adapter field, ignored: the host never publishes generated paraphrases. */
  statement?: string | null;
  /** Exact standalone replacement proposition; null keeps the complete correction report. */
  replacementQuote?: string | null;
  sourceIds: string[]; sourceQuote: string; targetId: string | null;
  factKey: string | null; correctionQuote: string | null; reason: string | null;
}
export interface ReconciliationResult {
  content: string; appliedOperationIds: string[];
  appliedOperations: Array<{id:string;sourceIds:string[];ideaIds:string[]}>;
  pending: Array<{ sourceIds: string[]; ideaIds:string[]; reason: string }>;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
export const reconciliationIdeaId = (ref:string,index:number,topic:string,spans:Array<{start:number;end:number}>) => `idea-${digest([ref,index,topic,spans.map(span=>[span.start,span.end])])}`;
const citationFor = (ref: string) => `[[${ref.replace(/^Log\//, "").replace(".md#", "#")}]]`;
const CITATION = /\[\[\d{4}-\d{2}-\d{2}#\^e-[a-f0-9]{6}(?:\|[^\]]*)?\]\]/g;
const clean = (line: string) => line.replace(/<!-- zenod-op:[a-f0-9]+ -->/g, "").replace(CITATION, "").replace(/^\s*[-*>]\s*/, "").replace(/^\*\*(?:Correction|Unresolved conflict):\*\*\s*/, "").replace(/\s*\(\s*\)\s*\.?$/, "").trim();
const equivalent = (a: string, b: string) => a.normalize("NFKC").replace(/[\s.,;:!?]+/gu, " ").trim().toLowerCase() === b.normalize("NFKC").replace(/[\s.,;:!?]+/gu, " ").trim().toLowerCase();
/** Obvious semantic changes cannot be hidden by a LINK_SOURCE decision.
 * Paraphrase equivalence beyond this floor remains the bounded model's judgment.
 */
function compatibleLink(a: string, b: string): boolean {
  const signature = (text: string) => ({
    numbers: [...text.matchAll(/\d+(?:[-./]\d+)*/g)].map(match => match[0]).sort().join("|"),
    negative: /\b(not|never|no|nunca|without|sin)\b/i.test(text),
    uncertain: /\b(may|might|could|perhaps|maybe|plan|hope|podr[ií]a|quiz[aá]s|posiblemente|planeo|espero)\b/i.test(text),
    actors: [...text.matchAll(/(?<![\p{L}\p{N}_])(\p{Lu}[\p{L}]+)\s+(?:approved|owns|leads|aprob[oó]|posee|dirige)(?![\p{L}\p{N}_])/gu)].map(match => match[1]).sort().join("|"),
  });
  return JSON.stringify(signature(a)) === JSON.stringify(signature(b));
}
/** Resolve bounded quotes to original text across adjacent host-addressed chunks.
 * Whitespace-only addressing never concatenates gaps or unrelated source blocks.
 */
function canonicalSourceQuote(sources: ReconciliationSource[], quote: string, limit: number, sourceContent?: string): string | null {
  if (!quote.trim() || quote.length > limit || !sources.length) return null;
  const ordered = [...sources].sort((a,b)=>a.start-b.start);
  if (ordered.some((source,index)=>!Number.isSafeInteger(source.start) || !Number.isSafeInteger(source.end)
    || source.start < 0 || source.end <= source.start || source.end-source.start !== source.text.length
    || (index>0 && source.start<ordered[index-1]!.end)
    || (sourceContent!==undefined && sourceContent.slice(source.start,source.end)!==source.text))) return null;
  const runs: SourceQuoteRun[] = [];
  for (const source of ordered) {
    const previous = runs.at(-1);
    if (previous && previous.start + previous.text.length === source.start) previous.text += source.text;
    else runs.push({ start: source.start, text: source.text });
  }
  return resolveRawSourceQuote(runs, quote, { maxRawChars: limit })?.quote ?? null;
}
interface PrepareInput {
  path: string; raw: string | null; title: string; type: string; today: string;
  repositoryRevision?: import("../vault/repository.js").VaultRevision;
  ideas?:ReconciliationIdea[];
  /** Canonical receipt outcomes already published for this evidence and branch. */
  completedIdeaIds?: readonly string[];
  /** Original host input, used only to verify chunk addresses; never sent to the model. */
  sourceContent?: string;
  facts?:FactProposal[];
  evidence: MemoryEntry; sources: ReconciliationSource[]; context: BranchContextPacket; links: string[];
}
export function prepareReconciliation(input: PrepareInput) {
  const parsed = input.raw === null ? null : parseNote(input.raw);
  const branch = input.context.branches.find(branch => branch.path === input.path);
  const revision = input.raw === null ? null : pageRevision(input.raw);
  if (branch && branch.revision !== revision) throw new Error("reconciliation_revision_changed");
  const statements: ReconciliationStatement[] = [];
  const targets = new Map<string, { start: number; end: number; line: string; text: string }>();
  const facts = parseMemoryFacts(parsed?.frontmatter?.memoryFacts);
  for (const section of branch?.sections ?? []) {
    for (const match of section.text.matchAll(/[^\n]+/g)) {
      const start = section.excerptStart + match.index!;
      const end = start + match[0].length;
      // Never target partial lines cut by a bounded excerpt.
      if ((start > 0 && parsed?.body[start - 1] !== "\n") || (end < (parsed?.body.length ?? 0) && parsed?.body[end] !== "\n")) continue;
      const text = clean(match[0]);
      if (!text || /^\s*(?:#|```|<!--|\[\[)/.test(text) || text.length > 1600) continue;
      const id = `st-${digest([input.path, section.id, text, statements.filter(statement => statement.text === text).length])}`;
      statements.push({id, text, sectionId: section.id, factKey: facts.find(fact => equivalent(fact.renderedStatement ?? fact.statement, text))?.key ?? null});
      targets.set(id, {start, end, line: match[0], text});
    }
  }
  const boundedStatements: ReconciliationStatement[] = [];
  for (const statement of statements) if (boundedStatements.length < 48 && JSON.stringify([...boundedStatements,statement]).length <= 8000) boundedStatements.push(statement);
  const boundedSources: ReconciliationSource[] = [];
  for (const source of input.sources) if (boundedSources.length < 24 && JSON.stringify([...boundedSources,source]).length <= 16000) boundedSources.push(source);
  const ideas: ReconciliationIdea[] = input.ideas ?? input.sources.map(source=>({id:`idea-${source.id}`,topic:source.text.slice(0,160),sourceIds:[source.id]}));
  const omittedSourcesByIdea = new Map<string,string[]>();
  const boundedIdeas=ideas.slice(0,24).map(idea=>{
    const sourceIds=idea.sourceIds.filter(id=>boundedSources.some(source=>source.id===id)).slice(0,8);
    const omitted=idea.sourceIds.filter(id=>!sourceIds.includes(id));
    if(omitted.length) omittedSourcesByIdea.set(idea.id,omitted);
    return {...idea,topic:idea.topic.slice(0,160),...(idea.priorFailure ? {priorFailure:idea.priorFailure.slice(0,240)} : {}),sourceIds,sourcePartial:omitted.length>0,omittedSourceCount:omitted.length};
  });
  for(const idea of ideas.slice(24)) omittedSourcesByIdea.set(idea.id,[...idea.sourceIds]);
  const request: ReconciliationInput = {path: input.path, revision, contextPartial: input.context.partial || boundedStatements.length < statements.length || boundedSources.length < input.sources.length || ideas.length>24, statements: boundedStatements, sources: boundedSources,ideas:boundedIdeas};
  for (const id of targets.keys()) if (!boundedStatements.some(statement => statement.id === id)) targets.delete(id);
  return {input, request, targets, ideas, omittedSourcesByIdea};
}
export type PreparedReconciliation = ReturnType<typeof prepareReconciliation>;

/** Apply supported minimal changes; IDs/revisions prove addresses, not semantic entailment. */
export async function applyReconciliation(prepared: PreparedReconciliation, operations: ReconciliationOperation[]): Promise<ReconciliationResult> {
  const {input, targets} = prepared;
  const result: ReconciliationResult = {content: input.raw ?? "", appliedOperationIds: [], appliedOperations: [], pending: []};
  const parsed = input.raw === null ? null : parseNote(input.raw);
  if (input.raw?.startsWith("---") && !parsed?.frontmatter) {
    result.pending.push({sourceIds: input.sources.map(source => source.id), ideaIds:prepared.ideas.map(idea=>idea.id), reason: "malformed_legacy_frontmatter"}); return result;
  }
  const citation = citationFor(input.evidence.evidenceRef);
  const edits = new Map<string, { start: number; end: number; text: string }>();
  const additions: string[] = [];
  const proposals: FactProposal[] = [];
  const validatedFactSupport = new Set<string>();
  const covered = new Set<string>();
  const seen = new Set<string>();
  const completed = new Set(input.completedIdeaIds ?? []);
  const assignedIdeas = (operation: ReconciliationOperation) => [...new Set(operation.ideaIds ?? (input.ideas ? [] : prepared.ideas.filter(idea=>idea.sourceIds.some(id=>operation.sourceIds.includes(id))).map(idea=>idea.id)))];
  // Validate the whole decision envelope before any per-idea mutation. A valid
  // ADD followed by an invalid LINK is one contradictory decision, not success.
  const decisions = new Map<string, number>();
  for (const operation of operations) for (const id of assignedIdeas(operation)) decisions.set(id,(decisions.get(id) ?? 0)+1);
  const rejected = new Set<string>();
  for (const idea of prepared.ideas) {
    if (completed.has(idea.id)) { covered.add(idea.id); continue; }
    if (operations.length > 24 || (decisions.get(idea.id) ?? 0)>1) {
      rejected.add(idea.id); covered.add(idea.id);
      result.pending.push({sourceIds:idea.sourceIds,ideaIds:[idea.id],reason:operations.length>24 ? "reconciliation_decision_budget_exceeded" : "reconciliation_multiple_decisions"});
    }
  }
  for (const proposed of operations.slice(0, 24)) {
    // Never mutate model output. Canonical raw quotes precede operation identity,
    // target checks and fact persistence, including correction/replacement fields.
    const operation = { ...proposed };
    const sourceIds = [...new Set(operation.sourceIds)];
    const ideaIds = assignedIdeas(operation).filter(id=>!completed.has(id));
    if (!ideaIds.length && assignedIdeas(operation).some(id=>completed.has(id))) continue;
    if (ideaIds.some(id=>rejected.has(id))) {
      for (const id of ideaIds.filter(id=>!rejected.has(id))) {
        covered.add(id); result.pending.push({sourceIds,ideaIds:[id],reason:"reconciliation_shared_decision_invalid"});
      }
      continue;
    }
    const sources = sourceIds.map(id => prepared.request.sources.find(source => source.id === id));
    const fail = (reason: string) => result.pending.push({sourceIds, ideaIds, reason});
    // Missing later evidence may negate/correct an earlier span of this idea.
    // Do not publish a provisional current claim from incomplete source support.
    if (ideaIds.some(id=>prepared.omittedSourcesByIdea.has(id))) continue;
    if (!ideaIds.length || ideaIds.some(id=>!prepared.request.ideas.some(idea=>idea.id===id && idea.sourceIds.some(sourceId=>sourceIds.includes(sourceId))))) { fail("idea_assignment_invalid"); continue; }
    const canonical = (quote: string, limit = 1600) => canonicalSourceQuote(sources as ReconciliationSource[],quote,limit,input.sourceContent);
    const sourceQuote = sourceIds.length && !sources.some(source => !source) ? canonical(operation.sourceQuote) : null;
    if (!sourceQuote) { fail("source_support_invalid"); continue; }
    operation.sourceQuote = sourceQuote;
    if (operation.replacementQuote) {
      const replacement = operation.kind === "supersede" ? canonical(operation.replacementQuote) : null;
      if (!replacement) { fail("replacement_support_invalid"); continue; }
      operation.replacementQuote = replacement;
    }
    if (operation.kind === "supersede" && operation.correctionQuote) {
      const correction = canonical(operation.correctionQuote,2400);
      if (!correction) { fail("correction_target_or_intent_unverified"); continue; }
      operation.correctionQuote = correction;
    }
    for (const id of ideaIds) covered.add(id);
    const id = digest([input.evidence.evidenceRef, ideaIds.sort(), sourceIds.sort(), operation.kind, operation.targetId, operation.sourceQuote, operation.replacementQuote??null, operation.kind === "supersede" ? operation.correctionQuote : null]);
    const marker = `<!-- zenod-op:${id} -->`;
    if (input.raw?.includes(marker) || seen.has(id)) {
      result.appliedOperationIds.push(id); result.appliedOperations.push({id,sourceIds,ideaIds});
      if (operation.kind === "conflict") fail("conflict_retained");
      continue;
    }
    const statement = operation.kind === "supersede"
      ? operation.replacementQuote ?? operation.correctionQuote ?? operation.sourceQuote : operation.sourceQuote;
    if (statement.length > 1600) {fail("complete_statement_exceeds_budget");continue;}
    const target = operation.targetId ? targets.get(operation.targetId) : undefined;
    // Preserve only the existing explicit retraction/target mismatch floor.
    // No new-only replacement or unrelated date is treated as old-value proof.
    if (operation.kind === "supersede" && target) {
      const retracted=[...(operation.correctionQuote ?? "").matchAll(/\b(?:ya\s+no|no\s+longer|not|no)\b[^;,.\n]*?(?=\s*\b(?:but|sino)\b|[;,])/giu)];
      const oldNumbers=new Set(target.text.match(/\d+(?:[-./]\d+)*/g) ?? []);
      const retired=retracted.length===1 ? retracted[0]![0].match(/\d+(?:[-./]\d+)*/g) ?? [] : [];
      if(retired.some(value=>!oldNumbers.has(value))) {fail("correction_target_values_incompatible");continue;}
    }
    if (operation.kind === "supersede" && target?.line.includes(citation)) { fail("reconciliation_same_evidence_target"); continue; }
    if (operation.kind === "supersede" && target && equivalent(statement,target.text)) { fail("correction_new_state_unchanged"); continue; }
    if (operation.kind === "add" && operation.targetId !== null) { fail("add_target_must_be_null"); continue; }
    if (operation.kind === "add" && [...targets.values()].some(existing=>existing.line.includes(citation) && equivalent(existing.text,statement))) {
      result.appliedOperationIds.push(id); result.appliedOperations.push({id,sourceIds,ideaIds}); continue;
    }
    if (operation.kind === "clarify") { fail("reconciliation_needs_clarification"); continue; }
    if ((operation.kind === "link_source" || operation.kind === "supersede" || operation.targetId !== null) && !target) { fail("statement_target_invalid"); continue; }
    if (operation.kind === "link_source") {
      if (!compatibleLink(target!.text, operation.sourceQuote)) { fail("equivalence_not_established"); continue; }
      const current = edits.get(operation.targetId!)?.text ?? target!.line;
      if (!current.includes(citation)) edits.set(operation.targetId!, {start: target!.start, end: target!.end, text: `${current} ${citation} ${marker}`});
    } else {
      const knownKey = prepared.request.statements.find(statement => statement.id === operation.targetId)?.factKey;
      const factKey = operation.kind === "supersede" || operation.kind === "conflict" ? knownKey ?? (target ? operation.factKey ?? `legacy.${digest([input.path,target.text])}` : `report.${digest([input.path,input.evidence.evidenceRef,ideaIds])}`) : operation.factKey;
      const legacy = operation.kind === "supersede" && !knownKey && input.repositoryRevision && input.raw !== null
        ? {path:input.path,statement:target!.text,statementId:operation.targetId!,contentHash:pageRevision(input.raw),provider:input.repositoryRevision.provider,revision:input.repositoryRevision.id} : undefined;
      if (operation.kind === "supersede" && ((!knownKey && !legacy) || !factKey || !operation.correctionQuote)) { fail("correction_target_or_intent_unverified"); continue; }
      const classifiedFact=input.facts?.find(fact=>fact.key===factKey && canonical(fact.statement)===operation.sourceQuote);
      const effectiveDateQuote=classifiedFact?.effectiveDateQuote ? canonical(classifiedFact.effectiveDateQuote,2400) : null;
      const verificationQuote=classifiedFact?.verificationQuote ? canonical(classifiedFact.verificationQuote,2400) : null;
      const proposal: FactProposal | null = factKey ? {key: factKey, statement, ...(operation.kind==="conflict" ? {reportedConflict:true} : {}), ...(legacy ? {legacySupersedes:legacy} : {}), effectiveDate: classifiedFact?.effectiveDate??null, effectiveDateQuote,
        correctionQuote: operation.kind === "supersede" ? operation.correctionQuote : null,
        supersedesQuotes: operation.kind === "supersede" ? [target!.text] : [],
        ...(operation.kind === "supersede" ? {supersedesIds: parseMemoryFacts(parsed?.frontmatter?.memoryFacts).filter(fact => fact.key === factKey && equivalent(fact.renderedStatement ?? fact.statement, target!.text)).map(fact => fact.id)} : {}), verificationQuote} : null;
      if (operation.kind === "supersede") {
        const trialSeed = parsed?.frontmatter ? input.raw! : serializeNote({title:input.title,type:input.type,tags:[],summary:input.title,created:input.today,updated:input.today},parsed?.body??"");
        const trial = appendMemoryFacts(trialSeed, input.raw, [proposal!], input.evidence, [statement,operation.correctionQuote!].join("\n\n"));
        const fact = parseMemoryFacts(parseNote(trial).frontmatter?.memoryFacts).find(fact => fact.evidenceRef === input.evidence.evidenceRef && fact.statement === statement);
        if ((!fact?.supersedes.length && !fact?.legacySupersedes) || fact.unresolvedCorrection) { fail("correction_direction_unverified"); continue; }
      }
      if (proposal) {
        proposals.push(proposal);
        // Each exact quote was independently checked against selected chunks.
        // Passing those validated quotes avoids inventing separators inside a
        // crossing proposition when the temporal layer verifies source support.
        validatedFactSupport.add(statement);
        if (operation.kind === "supersede") validatedFactSupport.add(operation.correctionQuote!);
        for (const quote of [effectiveDateQuote,verificationQuote]) {
          if (quote) validatedFactSupport.add(quote);
        }
      }
      const qualifier = operation.kind === "supersede" ? "**Correction:** " : operation.kind === "conflict" ? "**Unresolved conflict:** " : "";
      additions.push(`\n- ${qualifier}${statement.replace(/\n/g," ")} ${citation} ${marker}`);
      if (operation.kind === "conflict") fail("conflict_retained");
    }
    seen.add(id); result.appliedOperationIds.push(id); result.appliedOperations.push({id,sourceIds,ideaIds});
  }
  for (const idea of prepared.ideas) {
    if (completed.has(idea.id)) continue;
    const omitted=prepared.omittedSourcesByIdea.get(idea.id);
    if (omitted?.length) result.pending.push({sourceIds:omitted,ideaIds:[idea.id],reason:"reconciliation_source_context_incomplete"});
    else if (!covered.has(idea.id)) result.pending.push({sourceIds:idea.sourceIds,ideaIds:[idea.id],reason:"reconciliation_idea_unassigned"});
  }
  if (!result.appliedOperationIds.length || (!edits.size && !additions.length)) return result;
  let body = parsed?.body ?? "";
  for (const edit of [...edits.values()].sort((a,b) => b.start - a.start)) body = body.slice(0, edit.start) + edit.text + body.slice(edit.end);
  body += additions.join("");
  // Ordinary legacy Markdown gets a host-authored envelope; every body byte survives.
  const metadata = parsed?.frontmatter ?? {title: input.title, type: input.type, tags: [], created: input.today, updated: input.today, summary: input.title.slice(0,480)};
  let next = parsed?.frontmatter ? input.raw!.slice(0,input.raw!.length-parsed.body.length)+body : serializeNote(metadata, "") + body;
  if (proposals.length) {
    const withFacts = appendMemoryFacts(next, input.raw, proposals, input.evidence, [...validatedFactSupport].join("\n\n"));
    next = serializeNote(parseNote(withFacts).frontmatter!, "").slice(0,parsed?.frontmatter ? -1 : undefined) + body;
  }
  if (input.links.length && !input.links.some(link => body.includes(link))) next += `\n\n${input.links.slice(0,3).join(" ")}\n`;
  result.content = next;
  return result;
}
