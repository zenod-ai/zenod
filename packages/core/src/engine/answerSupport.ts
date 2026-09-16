import { createHash } from "node:crypto";
import type { NotePassage } from "../ops/passage.js";
import { renderFactViews, type FactView } from "./temporalFacts.js";

export type AnswerSupportMode = "current" | "historical" | "prior" | "conflict" | "raw_report";
export interface AnswerSupportSelection { id: string; mode: AnswerSupportMode; summaryText?: string | undefined }
export interface AnswerSupportHint { id: string; modes: AnswerSupportMode[]; kind: "fact" | "prior" | "passage" | "source_summary"; summaryOnly?:true; factId?: string; key?: string; excerpt?: string; start?: number; end?: number; offsetUnit?: "decoded-region-utf16"; regionStart?: number; granularity?: "paragraph" | "sentence" | "list_item" }
type Support = { hint: AnswerSupportHint; view: FactView; factId?: string; priorId?: string }
  | { hint: AnswerSupportHint; passage: NotePassage; text: string; summaryOnly?:true };
const digest = (value: unknown) => `as_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
export const ANSWER_SUPPORT_INSTRUCTION = "For a factual memory answer select the relevant answerSupports IDs and their allowed modes. Finish by calling submit_memory_answer with supportSelections containing exact id/mode pairs copied from these answerSupports. Choose mode only from that ID's modes array; raw_report is not current. Do not emit prose or JSON as final text. Select all requested subjects, including raw-only hypotheses and prior/conflicting reports. For a concise source-grounded answer or requested source summary, write the answer in summaryText (at most 1200 characters) on each selected raw_report passage. Always include summaryText in the model submission. Choose null explicitly only for a verbatim excerpt or canonical fact mode; null does not summarize. Use a few complete relevant supports while retaining all requested subjects and necessary qualifications. Synthesize only the selected source, preserving speaker attribution, options, doubt, negation and conditions. Preserve ambiguous numbers as ambiguous; do not infer their unit, meaning or a corrected value. The host supplies citations; do not put links or URLs in summaryText. For a whole-note summary prefer the source_summary handle when available: it proves the complete exact source was read and requires nonempty summaryText; null is forbidden for that handle. It does not establish semantic truth. Initial raw-source body reads automatically read the uniquely identified exact source within the shared automatic allowance. Cursor continuations, frontmatter and ordinary meaning-page reads retain their bounded scope. Otherwise read the whole requested note through its cursors, or explicitly label the summary partial with unread coverage. For other modes the host renders canonical source wording and citations; do not invent IDs or keys. Check relevance before selecting: an available source-backed fact may answer a different question. readPartial/nextCursor describes unread source scope, separately from answerSupportPartial. If readPartial is true and requested information is missing, continue with nextCursor and omit query, or seek with a literal query and omit cursor. Never send query and cursor together. If answerSupportPartial is true, some source edges or selection metadata remain unavailable; continue bounded reads or seek the relevant passage. Sentence IDs are exact raw excerpts, not complete reports: select every sentence needed to preserve attribution, negation, uncertainty and corrections visible in the surrounding source. Prefer the smallest complete relevant support; use the parent paragraph when qualifications cannot be preserved by the selected children. Earlier IDs remain valid in this turn. Read missing evidence or broader read_facts scope if the requested key is absent. No matching support means an empty selection, not proof of absence. For a requested opinion, recommendation or interpretation, put your concise assessment in analysisText and select the source premises supporting it. Distinguish your inference from what the speaker reported; preserve uncertainty, conditions and current/prior/conflict status. Do not claim the assessment is stored or independently verified. Use analysisText:null for source-only answers. Ordinary conversation or completed non-memory actions may use normal prose.";

// Intl may split a newline-delimited attribution from the following sentence.
// Keep that prefix attached instead of issuing an unqualified child handle.
function completeSentenceSegments(text:string, clippedStart:boolean, clippedEnd:boolean) {
  const segments:Array<{segment:string;index:number}>=[];
  let pending="",start=0;
  const parts=[...new Intl.Segmenter(undefined,{granularity:"sentence"}).segment(text)];
  for(const part of parts) {
    if(!pending) start=part.index;
    pending+=part.segment;
    if(/[.!?。！？]["'”’)]*\s*$/u.test(pending)) { segments.push({segment:pending,index:start});pending=""; }
  }
  // Drop unknown edges only after grouping attribution with its sentence.
  // Otherwise a clipped "jected claim:\n" could expose the next claim alone.
  if(pending) segments.push({segment:pending,index:start});
  if(clippedStart) segments.shift();
  if(clippedEnd) segments.pop();
  return segments.filter(part=>/[.!?。！？]["'”’)]*\s*$/u.test(part.segment));
}

type SourceBlock = { text:string; start:number; granularity:"paragraph"|"list_item" };
const listMarker = /^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+\S/m;
function navigationOnly(text:string):boolean {
  return text.split("\n").every(line=>{
    const value=line.trim();
    return !value || /^#{1,6}\s/.test(value) || /^(?:[-*_]\s*){3,}$/.test(value)
      || !value.replace(/<!--[^]*?-->/g,"").replace(/\[\[[^\]]+\]\]/g,"").replace(/\[[^\]]*\]\([^)]*\)/g,"").trim();
  });
}
/** Markdown structure only: nested items and indented continuation paragraphs
 * stay with their top-level item. A prose attribution preceding a list stays
 * attached rather than becoming an unqualified child claim.
 */
function sourceBlocks(raw:string,isLog:boolean):SourceBlock[] {
  const paragraphs=[...raw.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g)].map(p=>({text:p[0],start:p.index!}));
  if(isLog) return paragraphs.map(p=>({...p,granularity:"paragraph"}));
  const grouped:Array<{text:string;start:number}>=[];
  for(const paragraph of paragraphs){
    const previous=grouped.at(-1);
    if(previous && ((listMarker.test(previous.text) && /^[ \t]+\S/.test(paragraph.text))
      || (!navigationOnly(previous.text) && /:\s*$/.test(previous.text) && listMarker.exec(paragraph.text)?.index===0))){
      previous.text=raw.slice(previous.start,paragraph.start+paragraph.text.length);
    } else grouped.push({...paragraph});
  }
  return grouped.flatMap<SourceBlock>(block=>{
    if(navigationOnly(block.text)) return [];
    const first=listMarker.exec(block.text);
    if(!first || first.index!==0) return [{...block,granularity:"paragraph" as const}];
    const indent=first[1]!.length;
    const starts=[...block.text.matchAll(/^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+\S/gm)]
      .filter(m=>m[1]!.length<=indent).map(m=>m.index!);
    return starts.map((start,i)=>({text:block.text.slice(start,starts[i+1]??block.text.length),start:block.start+start,granularity:"list_item" as const}))
      .filter(block=>!navigationOnly(block.text.replace(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/,"")));
  });
}

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
      const hint: AnswerSupportHint = { id: digest(["fact", view, fact.id]), kind: "fact", factId: fact.id, key: fact.key, modes, excerpt:fact.statement.slice(0,160) };
      this.supports.set(hint.id, { hint, view, factId: fact.id }); hints.push(hint);
    }
    for (const prior of view.priorStatements ?? []) {
      const hint: AnswerSupportHint = { id: digest(["prior", view.path, prior]), kind: "prior", modes: view.complete ? ["prior"] : [], excerpt: prior.statement.slice(0,160) };
      this.supports.set(hint.id, { hint, view, priorId: prior.statementId }); hints.push(hint);
    }
    return hints;
  }
  addPassage(passage: NotePassage, hintBudget = 32): AnswerSupportHint[] {
    hintBudget = Math.max(0, Math.min(32, Math.floor(hintBudget)));
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
    const anchored=/^Log\/.+\.md#\^e-[0-9a-f]{6}$/i.test(passage.identity);
    const summaryId=digest(["source_summary",passage.identity,passage.version]);
    const complete=anchored && group.every(p=>p.extent.unit==="utf16"&&p.extent.end-p.extent.start===p.body.length
      &&p.extent.sectionStart===passage.extent.sectionStart&&p.extent.sectionEnd===passage.extent.sectionEnd
      &&p.source.path===passage.source.path&&p.source.provider===passage.source.provider)
      ? regions.find(region=>region.start===passage.extent.sectionStart&&region.end===passage.extent.sectionEnd
        &&group.every(p=>region.body.slice(p.extent.start-region.start,p.extent.end-region.start)===p.body)
        &&region.body.split("\n").some(line=>line.startsWith("> ")&&line.slice(2).trim())) : undefined;
    const offerSummary=!!complete&&!this.supports.has(summaryId)&&hintBudget>0&&this.supports.size<256;
    const excerptBudget=hintBudget-(offerSummary?1:0);
    // Keep one global slot available for a completed anchored source summary.
    const excerptCap=this.passages.some(p=>/^Log\/.+\.md#\^e-[0-9a-f]{6}$/i.test(p.identity))?255:256;
    for (const region of regions) {
      const isLog = passage.source.path.startsWith("Log/");
      const raw = isLog ? region.body.split("\n").flatMap(line => line.startsWith("> ") ? [line.slice(2)] : line === ">" ? [""] : []).join("\n") : region.body;
      const paragraphs = sourceBlocks(raw,isLog);
      for (let i=0;i<paragraphs.length;i++) {
        const paragraph=paragraphs[i]!; const text=paragraph.text.trim();
        if (!text) continue;
        const clippedStart=!raw.slice(0,paragraph.start).trim() && region.start>region.first.extent.sectionStart;
        const clippedEnd=paragraph.start+paragraph.text.length>=raw.trimEnd().length && region.end<region.last.extent.sectionEnd;
        const partial=text.length>4000 || clippedStart || clippedEnd;
        if(partial) this.lastPassageSelectionPartial=true;
        // Sentence children expose exact actually-read excerpts, never a clipped
        // first/last sentence. Surrounding source stays visible to the selector;
        // semantic qualification completeness is not established by this handle.
        const parent={text,start:paragraph.start+paragraph.text.length-paragraph.text.trimStart().length,granularity:paragraph.granularity};
        const sentences=completeSentenceSegments(paragraph.text,clippedStart,clippedEnd)
          .map(segment=>({text:segment.segment.trim(),start:paragraph.start+segment.index+segment.segment.length-segment.segment.trimStart().length,granularity:"sentence" as const}));
        // Never split a list item's continuation qualifications into bare claims.
        // Complete prose may offer smaller existing sentence handles plus its
        // parent: qualification completeness remains a source-reading decision.
        const segments=paragraph.granularity==="list_item" ? (partial ? [] : [parent])
          : partial ? sentences : sentences.length>1 && !listMarker.test(paragraph.text) ? [...sentences,parent] : [parent];
        for(const segment of segments){
          if(!segment.text || segment.text.length>4000){this.lastPassageSelectionPartial=true;continue;}
          const hint: AnswerSupportHint = { id:digest(["passage",passage.identity,passage.version,region.start,segment.start,segment.text]),kind:"passage",modes:["raw_report"],excerpt:segment.text.slice(0,160),offsetUnit:"decoded-region-utf16",regionStart:region.start,start:segment.start,end:segment.start+segment.text.length,granularity:segment.granularity };
          if (this.supports.has(hint.id)) continue; // Earlier IDs remain usable in this turn.
          if (this.supports.size>=excerptCap || hints.length>=excerptBudget) { this.lastPassageSelectionPartial=true; continue; }
          this.supports.set(hint.id,{hint,passage,text:segment.text});hints.push(hint);
        }
      }
    }
    if(offerSummary){
      // Excerpts contain source text only; summary protocol belongs in the instruction.
      const hint:AnswerSupportHint={id:summaryId,kind:"source_summary",modes:["raw_report"],summaryOnly:true};
      this.supports.set(summaryId,{hint,passage,text:"",summaryOnly:true});hints.push(hint);
    }else if(complete&&!this.supports.has(summaryId))this.lastPassageSelectionPartial=true;
    return hints;
  }
  selectedViews(selections: AnswerSupportSelection[]): FactView[] {
    if (!Array.isArray(selections) || selections.length > 24) return [];
    return [...new Map(selections.flatMap(selection => { const support=selection && this.supports.get(selection.id); return support && "view" in support ? [[JSON.stringify(support.view), support.view] as const] : []; })).values()];
  }
  selectedPassages(selections: AnswerSupportSelection[]): NotePassage[] {
    if (!Array.isArray(selections) || selections.length > 24) return [];
    return [...new Map(selections.flatMap(selection => { const support=selection && this.supports.get(selection.id); return support && "passage" in support ? [[`${support.passage.identity}:${support.passage.version}`, support.passage] as const] : []; })).values()];
  }
  render(selections: AnswerSupportSelection[], analysisText?: string): { text: string; valid: boolean } {
    if (!Array.isArray(selections) || selections.length>24) return {text:"The selected answer support is invalid. Repeat the source reads before answering.",valid:false};
    const lines: string[]=[]; const seen=new Set<string>();
    for (const selection of selections) {
      const support=selection && this.supports.get(selection.id);
      if (!support || !support.hint.modes.includes(selection.mode)) return {text:"The answer selected unknown, unavailable or temporally incompatible support. Repeat the relevant source/fact reads; current state is not established by this selection.",valid:false};
      if ("summaryOnly" in support && support.summaryOnly && (typeof selection.summaryText!=="string"||!selection.summaryText.trim())) return {text:"A complete-source summary requires nonempty summaryText; raw excerpts are unavailable for this handle.",valid:false};
      if (selection.summaryText !== undefined && (typeof selection.summaryText !== "string" || !selection.summaryText.trim()
        || selection.summaryText.length > 1200 || selection.mode !== "raw_report" || !("passage" in support)
        || /https?:\/\/|\]\(|\[\[|<[^>]*>/i.test(selection.summaryText))) {
        return {text:"The source summary has invalid support or formatting. Repeat the supported source selection.",valid:false};
      }
      if (seen.has(selection.id)) continue; seen.add(selection.id);
      if ("passage" in support) {
        const ref=support.passage.identity, url=support.passage.source.url;
        if (selection.summaryText !== undefined) lines.push(`Source summary:\n${selection.summaryText.trim()}\n[${ref}](${url})`);
        else lines.push(`${support.hint.granularity === "sentence" ? "Raw source excerpt (selected sentences; surrounding qualifications may be omitted)" : "Raw source report"} (not independently verified current state):\n${support.text}\n[${ref}](${url})`);
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
    if (analysisText !== undefined) {
      if (typeof analysisText !== "string" || !analysisText.trim() || analysisText.length > 1600 || !seen.size
        || /https?:\/\/|\]\(|\[\[|<[^>]*>/i.test(analysisText)) {
        return { text: "An assessment requires valid nonempty source support and bounded plain text. Repeat the supported source selection.", valid: false };
      }
      lines.unshift(`My assessment (inference from the cited premises, not an established fact):\n${analysisText.trim()}\n\nSource premises:`);
    }
    return {text:[...new Set(lines)].join("\n\n") || "No supported answer was selected from the sources read. This is not proof of absence; read the relevant evidence or fact scope.",valid:true};
  }
}
