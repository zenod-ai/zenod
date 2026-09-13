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
  return {source,identity:ref,readPath:ref,version:"sha256:frozen",part:"body",frontmatterChars:0,body,extent:{unit:"utf16",start:0,end:body.length,total:body.length,scopeStart:0,scopeEnd:body.length,sectionStart:0,sectionEnd:body.length},omittedBefore:false,truncated:false,nextCursor:null,...options};
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
  it("retains a complete raw qualification and never upgrades it to current state",()=>{
    const registry=new AnswerSupportRegistry();const text="Rejected claim:\nWe repair batteries. This is only an unverified hypothesis.";
    const hints=registry.addPassage(passage(text));expect(hints).toHaveLength(1);
    expect(registry.render([{id:hints[0]!.id,mode:"raw_report"}]).text).toContain(text);
    expect(registry.render([{id:hints[0]!.id,mode:"current"}]).valid).toBe(false);
  });
  it("does not issue raw handles for partial edge paragraphs or metadata",()=>{
    const registry=new AnswerSupportRegistry();expect(registry.addPassage(passage("Unfinished qualification",{truncated:true}))).toEqual([]);
    expect(registry.addPassage(passage("Missing preceding qualification",{omittedBefore:true,version:"other"}))).toEqual([]);
    const hints=registry.addPassage(passage("One complete report.\n\nAnother complete report.",{version:"complete"}));
    expect(hints).toHaveLength(2);expect(hints.every(h=>!h.excerpt?.includes("source: test"))).toBe(true);
  });
  it("retains every selected source version for snapshot validation",()=>{
    const registry=new AnswerSupportRegistry();const first=registry.addPassage(passage("First complete report."));const second=registry.addPassage(passage("Second complete report.",{version:"changed"}));
    expect(registry.selectedPassages([{id:first[0]!.id,mode:"raw_report"},{id:second[0]!.id,mode:"raw_report"}]).map(p=>p.version)).toEqual(["sha256:frozen","changed"]);
    expect(first[0]).toMatchObject({offsetUnit:"decoded-region-utf16",regionStart:0});
  });
  it("keeps ordinary legacy prose compatible and malformed protocol fail-closed",()=>{
    expect(decodeSupportedAnswer("Hello!",[])).toEqual({text:"Hello!",readPaths:[]});
    const bad=decodeSupportedAnswer('{"supportSelections":',[]);expect(bad.text).toBe("");expect(new AnswerSupportRegistry().render(bad.supportSelections!).valid).toBe(false);
  });
});
