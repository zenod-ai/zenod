import { createHash } from "node:crypto";
import type { NotePassage } from "../ops/passage.js";
import { renderFactViews, type FactView } from "./temporalFacts.js";

export type AnswerSupportMode = "current" | "historical" | "prior" | "conflict" | "raw_report";
export interface AnswerSupportSelection { id: string; mode: AnswerSupportMode }
export interface AnswerSupportHint { id: string; modes: AnswerSupportMode[]; kind: "fact" | "prior" | "passage"; factId?: string; key?: string; excerpt?: string; start?: number; end?: number; offsetUnit?: "decoded-region-utf16"; regionStart?: number }
type Support = { hint: AnswerSupportHint; view: FactView; factId?: string; priorId?: string }
  | { hint: AnswerSupportHint; passage: NotePassage; text: string };
const digest = (value: unknown) => `as_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
export const ANSWER_SUPPORT_INSTRUCTION = "For a factual memory answer select the relevant answerSupports IDs and their allowed modes. Final response must be JSON {\"supportSelections\":[{\"id\":\"as_...\",\"mode\":\"current\"}]}. Select all requested subjects, including raw-only hypotheses and prior/conflicting reports. The host renders canonical source wording and citations; do not invent IDs or keys. If answerSupportPartial is true, some edge/oversized paragraphs or selection metadata remain unavailable; continue bounded reads or seek the relevant passage. Earlier IDs remain valid in this turn. Read missing evidence or broader read_facts scope if the requested key is absent. No matching support means an empty selection, not proof of absence. Ordinary conversation or completed non-memory actions may use normal prose.";

/** Turn-local handles for source actually read. Selection is semantic model work;
 * canonical text, identity, temporal status and citations remain host authority. */
export class AnswerSupportRegistry {
  private supports = new Map<string, Support>();
  private passages: NotePassage[] = [];
  lastPassageSelectionPartial = false;
  addFacts(view: FactView): AnswerSupportHint[] {
    const hints: AnswerSupportHint[] = [];
    for (const fact of view.facts) {
      const modes: AnswerSupportMode[] = !view.complete || !fact.source || fact.status === "unsupported" || fact.status === "future" ? []
        : fact.status === "superseded" ? ["prior"] : fact.status === "conflict" ? ["conflict"]
        : fact.status === "undated" ? ["raw_report"] : [view.mode === "historical" ? "historical" : "current"];
      const hint: AnswerSupportHint = { id: digest(["fact", view, fact.id]), kind: "fact", factId: fact.id, key: fact.key, modes };
      this.supports.set(hint.id, { hint, view, factId: fact.id }); hints.push(hint);
    }
    for (const prior of view.priorStatements ?? []) {
      const hint: AnswerSupportHint = { id: digest(["prior", view.path, prior]), kind: "prior", modes: view.complete ? ["prior"] : [], excerpt: prior.statement.slice(0,160) };
      this.supports.set(hint.id, { hint, view, priorId: prior.statementId }); hints.push(hint);
    }
    return hints;
  }
  addPassage(passage: NotePassage): AnswerSupportHint[] {
    this.lastPassageSelectionPartial = false;
    if (passage.part !== "body") return [];
    this.passages.push(passage);
    const group = this.passages.filter(p => p.identity === passage.identity && p.version === passage.version).sort((a,b) => a.extent.start-b.extent.start);
    // Reconstruct only contiguous actually-read bytes. Never bridge an unread gap.
    const regions: Array<{ body: string; start: number; end: number; first: NotePassage; last: NotePassage }> = [];
    for (const p of group) {
      const last = regions.at(-1);
      if (!last || p.extent.start > last.end) regions.push({ body:p.body,start:p.extent.start,end:p.extent.end,first:p,last:p });
      else if (p.extent.end > last.end) { last.body += p.body.slice(last.end-p.extent.start); last.end=p.extent.end;last.last=p; }
    }
    const hints: AnswerSupportHint[] = [];
    for (const region of regions) {
      const isLog = passage.source.path.startsWith("Log/");
      const raw = isLog ? region.body.split("\n").flatMap(line => line.startsWith("> ") ? [line.slice(2)] : line === ">" ? [""] : []).join("\n") : region.body;
      const paragraphs = [...raw.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g)];
      for (let i=0;i<paragraphs.length;i++) {
        const paragraph=paragraphs[i]!; const text=paragraph[0].trim();
        if (!text) continue;
        if (text.length>4000 || (i===0 && region.first.omittedBefore) || (i===paragraphs.length-1 && region.last.truncated)) { this.lastPassageSelectionPartial=true; continue; }
        const hint: AnswerSupportHint = { id:digest(["passage",passage.identity,passage.version,region.start,paragraph.index,text]),kind:"passage",modes:["raw_report"],excerpt:text.slice(0,160),offsetUnit:"decoded-region-utf16",regionStart:region.start,start:paragraph.index!,end:paragraph.index!+paragraph[0].length };
        if (this.supports.has(hint.id)) continue; // Earlier IDs remain usable in this turn.
        if (this.supports.size>=256 || hints.length>=32) { this.lastPassageSelectionPartial=true; continue; }
        this.supports.set(hint.id,{hint,passage,text});hints.push(hint);
      }
    }
    return hints;
  }
  selectedPassages(selections: AnswerSupportSelection[]): NotePassage[] {
    if (!Array.isArray(selections) || selections.length > 24) return [];
    return [...new Map(selections.flatMap(selection => { const support=selection && this.supports.get(selection.id); return support && "passage" in support ? [[`${support.passage.identity}:${support.passage.version}`, support.passage] as const] : []; })).values()];
  }
  render(selections: AnswerSupportSelection[]): { text: string; valid: boolean } {
    if (!Array.isArray(selections) || selections.length>24) return {text:"The selected answer support is invalid. Repeat the source reads before answering.",valid:false};
    const lines: string[]=[]; const seen=new Set<string>();
    for (const selection of selections) {
      const support=selection && this.supports.get(selection.id);
      if (!support || !support.hint.modes.includes(selection.mode)) return {text:"The answer selected unknown, unavailable or temporally incompatible support. Repeat the relevant source/fact reads; current state is not established by this selection.",valid:false};
      if (seen.has(selection.id)) continue; seen.add(selection.id);
      if ("passage" in support) {
        const ref=support.passage.identity, url=support.passage.source.url;
        lines.push(`Raw source report (not independently verified current state):\n${support.text}\n[${ref}](${url})`);
      } else if (support.priorId) {
        const prior=support.view.priorStatements!.find(p=>p.statementId===support.priorId)!;
        lines.push(`Prior note statement (superseded; original evidence/date unknown): ${prior.statement}\n${prior.path}, ${prior.provider} revision ${prior.revision}; correction evidence ${prior.supersededByEvidenceRef}.`);
      } else {
        const fact=support.view.facts.find(f=>f.id===support.factId)!;
        // All versions of the selected key remain visible to the temporal renderer.
        // A current ID cannot lend authority to arbitrary model-authored wording.
        const scoped={...support.view,facts:support.view.facts.filter(f=>f.key===fact.key),priorStatements:(support.view.priorStatements??[]).filter(p=>support.view.facts.some(f=>f.key===fact.key&&f.legacySupersedes?.statementId===p.statementId))};
        if(selection.mode==="prior") lines.push(`Prior source report (superseded): ${fact.statement}\n[${fact.evidenceRef}](${fact.source!.url})`);
        else lines.push(renderFactViews([scoped]));
      }
    }
    return {text:[...new Set(lines)].join("\n\n") || "No supported answer was selected from the sources read. This is not proof of absence; read the relevant evidence or fact scope.",valid:true};
  }
}
