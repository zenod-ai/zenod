import { describe, expect, it } from "vitest";
import { AnswerSupportRegistry } from "../src/engine/answerSupport.js";
import { decodeSupportedAnswer } from "../src/llm/answerSupportProtocol.js";
import type { FactView } from "../src/engine/temporalFacts.js";
import type { NotePassage } from "../src/ops/passage.js";
const source={path:"Log/2026-09-13.md",url:"https://example.invalid/source",provider:"github" as const,revisionId:"frozen"};
const ref=source.path+"#^e-123abc";
function view(): FactView {
  const fact=(id:string,statement:string,status:"active"|"superseded"|"conflict")=>({id,key:"date",statement,status,evidenceRef:ref,evidenceDate:null,origin:"user_report" as const,supersedes:[],unresolvedCorrection:false,effectiveDate:null,effectiveDateQuote:null,correctionQuote:null,supersedesQuotes:[],verificationQuote:null,source});
  return {path:"Notes/Atlas.md",mode:"current",asOf:"2026-09-13",scope:"selected-note-facts",complete:true,legacy:false,warnings:[],facts:[fact("old","El taller será el 12 de octubre.","superseded"),fact("new","El taller será el 19 de octubre.","active")]};
}
function passage(text:string, options:Partial<NotePassage>={}):NotePassage {
  const body=`## Capture ^e-123abc\n- source: test\n\n${text.split("\n").map(line=>"> "+line).join("\n")}`;
  return {source,identity:ref,readPath:ref,version:"sha256:frozen",part:"body",frontmatterChars:0,body,extent:{unit:"utf16",start:0,end:body.length,total:body.length,scopeStart:0,scopeEnd:body.length,sectionStart:options.omittedBefore ? -1 : 0,sectionEnd:body.length+(options.truncated ? 1 : 0)},omittedBefore:false,truncated:false,nextCursor:null,...options};
}
describe("explicit source selection contract",()=>{
  it("selects canonical current state across question languages and ignores arbitrary wrong model wording",()=>{
    const registry=new AnswerSupportRegistry();const hints=registry.addFacts(view());
    const result=decodeSupportedAnswer(JSON.stringify({text:"The date is October 12 and batteries ARE repaired.",supportSelections:[{id:hints[1]!.id,mode:"current"}]}),[]);
    expect(result.text).toBe("");const rendered=registry.render(result.supportSelections!);
    expect(rendered.text).toContain("19 de octubre");expect(rendered.text).not.toContain("12 de octubre");expect(rendered.text).not.toContain("ARE repaired");
  });
  it("refuses stale-current, unknown IDs and wrong modes",()=>{
    const registry=new AnswerSupportRegistry();const hints=registry.addFacts(view());
    expect(registry.render([{id:hints[0]!.id,mode:"current"}]).valid).toBe(false);
    expect(registry.render([{id:"invented",mode:"current"}]).valid).toBe(false);
    expect(registry.render([{id:hints[1]!.id,mode:"prior"}]).valid).toBe(false);
    expect(registry.render([{id:hints[0]!.id,mode:"prior"}]).text).toContain("12 de octubre");
  });
  it("retains whole conflicting key and requested historical mode",()=>{
    const registry=new AnswerSupportRegistry();const v=view();v.facts.forEach(f=>f.status="conflict");
    const hints=registry.addFacts(v);expect(registry.render([{id:hints[0]!.id,mode:"conflict"}]).text).toContain("19 de octubre");
    expect(registry.render([{id:hints[0]!.id,mode:"current"}]).valid).toBe(false);
    const historical=registry.addFacts({...view(),mode:"historical"});
    expect(registry.render([{id:historical[1]!.id,mode:"historical"}]).text).toContain("Historical effective state");
  });
  it("an assessment preserves canonical current, prior, historical and conflict premises",()=>{
    const registry=new AnswerSupportRegistry();const hints=registry.addFacts(view());
    for(const selection of [{id:hints[1]!.id,mode:"current" as const},{id:hints[0]!.id,mode:"prior" as const}]){
      const canonical=registry.render([selection]);const assessed=registry.render([selection],"Confirm the date before making arrangements.");
      expect(assessed.valid).toBe(true);expect(assessed.text).toContain(canonical.text);
    }
    const conflicting=view();conflicting.facts.forEach(f=>f.status="conflict");const conflict=registry.addFacts(conflicting)[0]!;
    const historical=registry.addFacts({...view(),mode:"historical"})[1]!;
    for(const selection of [{id:conflict.id,mode:"conflict" as const},{id:historical.id,mode:"historical" as const}]){
      expect(registry.render([selection],"Confirm the conflicting or historical report.").text).toContain(registry.render([selection]).text);
    }
  });
  it("retains a complete raw qualification and never upgrades it to current state",()=>{
    const registry=new AnswerSupportRegistry();const text="Rejected claim:\nWe repair batteries. This is only an unverified hypothesis.";
    const hints=registry.addPassage(passage(text));const parent=hints.find(h=>h.granularity==="paragraph")!;
    expect(hints.filter(h=>h.granularity==="sentence")[0]!.excerpt).toContain("Rejected claim:");
    expect(registry.render([{id:parent.id,mode:"raw_report"}]).text).toContain(text);
    expect(registry.render([{id:hints[0]!.id,mode:"current"}]).valid).toBe(false);
  });
  it("does not issue raw handles for partial edge paragraphs or metadata",()=>{
    const registry=new AnswerSupportRegistry();expect(registry.addPassage(passage("Unfinished qualification",{truncated:true}))).toEqual([]);
    expect(registry.addPassage(passage("Missing preceding qualification",{omittedBefore:true,version:"other"}))).toEqual([]);
    const hints=registry.addPassage(passage("One complete report.\n\nAnother complete report.",{version:"complete"}));
    expect(hints.filter(h=>h.kind==="passage")).toHaveLength(2);expect(hints.filter(h=>h.kind==="source_summary")).toHaveLength(1);expect(hints.every(h=>!h.excerpt?.includes("source: test"))).toBe(true);
  });
  it("offers focused complete sentences from long bilingual source without unrelated details",()=>{
    const registry=new AnswerSupportRegistry();
    const text="La visión es conservar conocimiento durable.\nThe workshop color is amber.\n"+"Background material. ".repeat(550);
    const hints=registry.addPassage(passage(text,{truncated:true}));
    const vision=hints.find(h=>h.excerpt?.startsWith("La visión"))!;
    expect(vision.granularity).toBe("sentence");expect(hints.length).toBeLessThanOrEqual(32);
    expect(registry.lastPassageSelectionPartial).toBe(true);
    const rendered=registry.render([{id:vision.id,mode:"raw_report"}]);
    expect(rendered.text).toContain("La visión es conservar conocimiento durable.");
    expect(rendered.text).not.toContain("amber");expect(rendered.text).toContain("Raw source excerpt");
    expect(text.slice(vision.start,vision.end)).toBe(vision.excerpt);
  });
  it("retains cross-sentence qualification when the selector requests both supports",()=>{
    const registry=new AnswerSupportRegistry();
    const hints=registry.addPassage(passage("Students learn faster. This is only an unverified hypothesis. "+"Other context. ".repeat(400)));
    const selected=hints.slice(0,2).map(h=>({id:h.id,mode:"raw_report" as const}));
    const text=registry.render(selected).text;
    expect(text).toContain("Students learn faster.");expect(text).toContain("only an unverified hypothesis");
    // Selection carries semantic responsibility: a sentence handle is not a proof
    // that every relevant neighboring qualification was selected.
    expect(registry.render(selected.slice(0,1)).text).toContain("surrounding qualifications may be omitted");
  });
  it("keeps newline attribution attached to its sentence in long source",()=>{
    const registry=new AnswerSupportRegistry();
    const hints=registry.addPassage(passage("Rejected claim:\nWe repair batteries. "+"Other context. ".repeat(400)));
    expect(hints[0]!.excerpt).toBe("Rejected claim:\nWe repair batteries.");
  });
  it("never offers clipped boundary fragments as complete sentence support",()=>{
    const registry=new AnswerSupportRegistry();
    const hints=registry.addPassage(passage("missing beginning. Complete middle report. Unfinished ending",{omittedBefore:true,truncated:true}));
    expect(hints.map(h=>h.excerpt)).toEqual(["Complete middle report."]);
  });
  it("drops a clipped attribution together with the claim it qualifies",()=>{
    const registry=new AnswerSupportRegistry();
    const hints=registry.addPassage(passage("jected claim:\nWe repair batteries. Complete report.",{omittedBefore:true}));
    expect(hints.map(h=>h.excerpt)).toEqual(["Complete report."]);
  });
  it("rejects punctuation at an unknown read edge, including a cut decimal",()=>{
    const registry=new AnswerSupportRegistry();
    const hints=registry.addPassage(passage("Complete report. The limit is 3.",{truncated:true}));
    expect(hints.map(h=>h.excerpt)).toEqual(["Complete report."]);
  });
  it("retains every selected source version for snapshot validation",()=>{
    const registry=new AnswerSupportRegistry();const first=registry.addPassage(passage("First complete report."));const second=registry.addPassage(passage("Second complete report.",{version:"changed"}));
    expect(registry.selectedPassages([{id:first[0]!.id,mode:"raw_report"},{id:second[0]!.id,mode:"raw_report"}]).map(p=>p.version)).toEqual(["sha256:frozen","changed"]);
    expect(first[0]).toMatchObject({offsetUnit:"decoded-region-utf16",regionStart:0});
  });
  it("keeps ordinary legacy prose compatible and malformed protocol fail-closed",()=>{
    expect(decodeSupportedAnswer("Hello!",[])).toEqual({text:"Hello!",readPaths:[]});
    const bad=decodeSupportedAnswer('{"supportSelections":',[]);expect(bad.text).toBe("");expect(bad.supportProtocolError).toBe("invalid_submission");expect(bad.supportSelections).toBeUndefined();
  });
});

function meaning(body:string, options:Partial<NotePassage>={}):NotePassage {
 const original=passage(body);return {...original,body,source:{...source,path:'Projects/Shared.md'},readPath:'Projects/Shared.md',identity:'Projects/Shared.md#section-0',extent:{unit:'utf16',start:0,end:body.length,total:body.length,scopeStart:0,scopeEnd:body.length,sectionStart:0,sectionEnd:body.length},...options};
}
it('offers complete list item handles instead of an unrelated first preview or backlink',()=>{
 const body='# Plan\n\n- The session moved to Friday.\n- Each visitor receives a reusable waterproof map.\n- Two places are free for rural teachers.\n\n[[Projects/Workshop|Workshop]]\n';
 const registry=new AnswerSupportRegistry();const hints=registry.addPassage(meaning(body));
 expect(hints).toHaveLength(3);expect(hints.every(h=>h.granularity==='list_item')).toBe(true);
 for(const phrase of ['reusable waterproof map','free for rural teachers']) {
  const hint=hints.find(h=>h.excerpt?.includes(phrase))!;expect(hint).toBeDefined();
  const selected=registry.render([{id:hint.id,mode:'raw_report'}]);expect(selected.text).toContain(phrase);expect(selected.text).not.toContain('Friday');expect(selected.text).not.toContain('[[Projects/Workshop');
  expect(body.slice(hint.start!,hint.end!)).toBe(hint.excerpt);
 }
});
it('keeps nested and blank-line continuation qualifications attached to the owning item',()=>{
 const first='- The proposed demo uses ropes.\n  This is not verified.\n  - Only a hypothesis.\n\n  It must not be presented as proven.';
 const body=first+'\n- A separate map requirement.\n';const registry=new AnswerSupportRegistry();const hints=registry.addPassage(meaning(body));
 expect(hints).toHaveLength(2);
 expect(registry.render([{id:hints[0]!.id,mode:'raw_report'}]).text).toContain(first);
 expect(hints.some(h=>h.excerpt?.startsWith('This is not'))).toBe(false);
});
it('does not detach a prose attribution introducing a list',()=>{
 const body='Unconfirmed claims:\n\n- The room holds twenty people.\n- The price may double.';
 const registry=new AnswerSupportRegistry();const hints=registry.addPassage(meaning(body));
 expect(hints).toHaveLength(1);expect(registry.render([{id:hints[0]!.id,mode:'raw_report'}]).text).toContain(body);
});
it('omits clipped list items while retaining complete interior items and current caps',()=>{
 const body='- First item with missing prior context.\n- Middle complete item.\n- Last item with unfinished qualifier';
 const p=meaning(body);p.extent.sectionStart=-5;p.extent.sectionEnd=body.length+20;
 const registry=new AnswerSupportRegistry();const hints=registry.addPassage(p);
 expect(hints.map(h=>h.excerpt)).toEqual(['- Middle complete item.']);expect(registry.lastPassageSelectionPartial).toBe(true);
 const many=Array.from({length:40},(_,i)=>`- Independent requirement ${i}.`).join('\n');
 const capped=new AnswerSupportRegistry();expect(capped.addPassage(meaning(many))).toHaveLength(32);expect(capped.lastPassageSelectionPartial).toBe(true);
});
it('gives fact handles a bounded exact statement preview without changing identity or modes',()=>{
 const registry=new AnswerSupportRegistry(),v=view();v.facts[1]!.statement='A long statement '+ 'qualified '.repeat(30);
 const hints=registry.addFacts(v);expect(hints[1]!.excerpt).toBe(v.facts[1]!.statement.slice(0,160));expect(hints[1]!.excerpt!.length).toBe(160);
 expect(hints[1]!.modes).toEqual(['current']);expect(registry.addFacts(v)[1]!.id).toBe(hints[1]!.id);
});

it('offers precise children for complete short prose while retaining the qualified parent',()=>{
 const body='The astronomy kit includes a reusable map. A rope demonstration might help explain orbits. This remains unverified.';
 const registry=new AnswerSupportRegistry();const hints=registry.addPassage(passage(body));
 const children=hints.filter(h=>h.granularity==='sentence');expect(children).toHaveLength(3);
 expect(children[0]!.excerpt).toContain('reusable map');
 expect(registry.render([{id:children[0]!.id,mode:'raw_report'}]).text).not.toContain('rope');
 const parent=hints.find(h=>h.granularity==='paragraph')!;expect(registry.render([{id:parent.id,mode:'raw_report'}]).text).toContain(body);
 expect(registry.render([{id:children[1]!.id,mode:'current'}]).valid).toBe(false);
});
it('keeps the 256-turn ceiling and recovers hints omitted only by the per-read budget',()=>{
 const raw=Array.from({length:40},(_,i)=>`- Requirement ${i}.`).join('\n');
 const registry=new AnswerSupportRegistry();const first=registry.addPassage(meaning(raw));const second=registry.addPassage(meaning(raw));
 expect(first).toHaveLength(32);expect(second).toHaveLength(8);expect(second[7]!.excerpt).toContain('Requirement 39');
 for(let i=1;i<7;i++) registry.addPassage(meaning(raw,{identity:`Projects/Other${i}.md#section-0`}));
 const remaining=registry.addPassage(meaning(raw,{identity:'Projects/Last.md#section-0'}));expect(remaining).toHaveLength(24);
 expect(registry.addPassage(meaning(raw,{identity:'Projects/Overflow.md#section-0'}))).toEqual([]);expect(registry.lastPassageSelectionPartial).toBe(true);
});
it('treats leading whitespace before a clipped attribution as an unknown source edge',()=>{
 const body='\n\njected claim:\nWe repair batteries. A complete separate statement. Tail remains incomplete';
 const p=meaning(body);p.extent.sectionStart=-20;p.extent.sectionEnd=body.length+20;
 const registry=new AnswerSupportRegistry();const hints=registry.addPassage(p);
 expect(hints.length).toBeGreaterThan(0);expect(hints.some(h=>h.excerpt?.includes('We repair batteries'))).toBe(false);
 expect(hints.some(h=>h.excerpt?.includes('complete separate statement'))).toBe(true);
});

describe("cited source summaries",()=>{
  it("preserves uncertain bilingual meaning as a concise cited summary rather than a transcript dump",()=>{
    const registry=new AnswerSupportRegistry();
    const raw="Quizá alquile una casa. No he decidido comprar; primero debo revisar el presupuesto. "+"We are still considering alternatives. ".repeat(20);
    const hints=registry.addPassage(passage(raw)).sort((a,b)=>Number(b.granularity === "paragraph")-Number(a.granularity === "paragraph"));
    const summaryText="Está considerando alquilar, pero no ha decidido comprar y debe revisar el presupuesto.";
    const decoded=decodeSupportedAnswer(JSON.stringify({supportSelections:[{id:hints[0]!.id,mode:"raw_report",summaryText}]}),[ref]);
    const result=registry.render(decoded.supportSelections!);
    expect(result.valid).toBe(true);expect(result.text).toContain(summaryText);expect(result.text).toContain(source.url);
    expect(result.text).not.toContain("alternatives. We");expect(result.text).toContain("Source summary:");
    expect(registry.render([{id:hints[0]!.id,mode:"raw_report"}]).text).toContain(raw.trim());
  });
  it("rejects missing/forged IDs, temporal summary overrides and model supplied citation links",()=>{
    const registry=new AnswerSupportRegistry();const facts=registry.addFacts(view());
    const hints=registry.addPassage(passage("This is an uncertain proposal."));
    expect(decodeSupportedAnswer(JSON.stringify({supportSelections:[{mode:"raw_report",summaryText:"A claim"}]}),[]).supportProtocolError).toBe("invalid_submission");
    expect(registry.render([{id:"as_"+"0".repeat(24),mode:"raw_report",summaryText:"A claim"}]).valid).toBe(false);
    expect(registry.render([{id:facts[1]!.id,mode:"current",summaryText:"The old date is current"}]).valid).toBe(false);
    expect(registry.render([{id:hints[0]!.id,mode:"raw_report",summaryText:"Claim [source](https://evil.invalid)"}]).valid).toBe(false);
    expect(registry.render([{id:hints[0]!.id,mode:"raw_report",summaryText:" "}]).valid).toBe(false);
  });
});

 it("rejects paraphrases on sentence handles while preserving verbatim and parent summaries",()=>{
  const registry=new AnswerSupportRegistry();
  const hints=registry.addPassage(passage("The room has a shelf. The repair estimate is tentative, pending inspection."));
  const sentence=hints.find(h=>h.granularity==="sentence")!;const parent=hints.find(h=>h.granularity==="paragraph")!;
  expect(sentence).toBeDefined();expect(parent).toBeDefined();
  const summaryText="The repair estimate remains conditional on inspection.";
  const rejected=registry.render([{id:sentence.id,mode:"raw_report",summaryText}],"An assessment must not bypass invalid premises.");
  expect(rejected.valid).toBe(false);expect(rejected.text).not.toContain(summaryText);expect(rejected.text).not.toContain("An assessment");
  expect(registry.render([{id:sentence.id,mode:"raw_report"}]).text).toContain("The room has a shelf.");
  expect(registry.render([{id:parent.id,mode:"raw_report",summaryText}]).valid).toBe(true);
 });
