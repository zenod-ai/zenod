import {AnswerSupportRegistry} from "../src/engine/answerSupport.js";
import type {NotePassage} from "../src/ops/passage.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrainLlm } from "../src/llm/aisdk.js";
const id="as_0123456789abcdef01234567";
const tools={searchChats:async()=>"none",readFacts:async()=>JSON.stringify({answerSupports:[{id,modes:["current"]}]})};
afterEach(()=>vi.unstubAllGlobals());
type Reply={text?:string;calls?:Array<{name:string;input:unknown}>};
function wire(replies:Array<Reply|(()=>Reply)>) {
 const requests:any[]=[];
 vi.stubGlobal("fetch",vi.fn(async (url:unknown,init:RequestInit)=>{
  expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
  const request=JSON.parse(String(init.body));requests.push(request);
  const queued=replies[requests.length-1];const reply=typeof queued==="function"?queued():queued;if(!reply)throw new Error("Unexpected extra model completion");
  const calls=reply.calls?.map((call,index)=>({id:`call-${requests.length}-${index}`,type:"function",index,function:{name:call.name,arguments:JSON.stringify(call.input)}}));
  const message={role:"assistant",content:reply.text??null,...(calls?{tool_calls:calls}:{})};
  const finish=calls?"tool_calls":"stop";
  const common={id:"synthetic-completion",created:0,model:"x-ai/grok-4.3",usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}};
  if(request.stream){
   const chunk={...common,object:"chat.completion.chunk",choices:[{index:0,delta:message,finish_reason:null}]};
   const end={...common,object:"chat.completion.chunk",choices:[{index:0,delta:{},finish_reason:finish}]};
   return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`,{headers:{"content-type":"text/event-stream"}});
  }
  return new Response(JSON.stringify({...common,object:"chat.completion",choices:[{index:0,message,finish_reason:finish}]}),{headers:{"content-type":"application/json"}});
 }));
 return requests;
}
const read={name:"read_facts",input:{path:"Notes/Atlas.md"}};
const submit={name:"submit_memory_answer",input:{analysisText:null,supportSelections:[{id,mode:"current",summaryText:null}]}};
const input={question:"¿Cuándo empieza?",vaultBriefing:"",conversation:[],answerSupportContract:"v1" as const,answerSupportScope:"memory_only" as const};
const llm=(maxSteps=5)=>createBrainLlm({provider:"openrouter",apiKey:"synthetic",askModel:"x-ai/grok-4.3",maxSteps});
describe("typed terminal answer submission through actual SDK wire",()=>{
 it.each([false,true])("requires typed submit after reads and stops without recovery/leakage (stream=%s)",async streaming=>{
  const requests=wire([{calls:[read]},{calls:[submit]}]);const deltas:string[]=[],events:string[]=[];
  const result=await llm().answer({...input,...(streaming?{onTextDelta:(s:string)=>deltas.push(s),onToolEvent:(e:{tool:string})=>events.push(e.tool)}:{})},tools);
  expect(result).toEqual({text:"",readPaths:[],supportSelections:[{id,mode:"current"}]});
  expect(requests).toHaveLength(2);expect(requests[1].tool_choice).toBe("required");
  expect(requests[1].tools.map((t:any)=>t.function.name).sort()).toEqual(["read_facts","submit_memory_answer"]);
  expect(requests[1].tools.find((t:any)=>t.function.name==="submit_memory_answer").function.parameters.properties.supportSelections.maxItems).toBe(24);
  expect(deltas).toEqual([]);expect(events).not.toContain("submit_memory_answer");
 });
 it.each([false,true])("keeps discovery nonterminal until a source read (stream=%s)",async streaming=>{
  const requests=wire([{calls:[{name:"search_vault",input:{query:"Atlas"}}]},{calls:[read]},{calls:[submit]}]);
  const discovery=vi.fn(async()=>"Notes/Atlas.md (score 9) — Atlas teaching plan");
  const result=await llm(8).answer({...input,...(streaming?{onTextDelta:()=>{}}:{})},{...tools,searchVault:discovery,readNote:async()=>"unused"});
  expect(requests).toHaveLength(3);
  expect(requests[1].tools.map((t:any)=>t.function.name)).not.toContain("submit_memory_answer");
  expect(requests[1].tools.map((t:any)=>t.function.name)).toContain("read_facts");
  expect(requests[2].tools.map((t:any)=>t.function.name)).toContain("submit_memory_answer");
  expect(result.supportSelections).toEqual([{id,mode:"current"}]);
 });
 it("rejects an unadvertised early empty submission after discovery only",async()=>{
  const requests=wire([{calls:[{name:"search_vault",input:{query:"Atlas"}}]},{calls:[{name:"submit_memory_answer",input:{analysisText:null,supportSelections:[]}}]}]);
  const result=await llm(8).answer(input,{...tools,searchVault:async()=>"Notes/Atlas.md (score 9) — Atlas",readNote:async()=>"unused"});
  expect(requests[1].tools.map((t:any)=>t.function.name)).not.toContain("submit_memory_answer");
  expect(result.supportProtocolError).toBe("invalid_submission");
  expect(result.supportSelections).toBeUndefined();
 });
 it("permits additional bounded reads then forces only submit in the last existing round",async()=>{
  const requests=wire([{calls:[read]},{calls:[read]},{calls:[submit]}]);
  const result=await llm(3).answer(input,tools);expect(result.supportSelections).toHaveLength(1);
  expect(requests).toHaveLength(3);expect(requests[2].tools.map((t:any)=>t.function.name)).toEqual(["submit_memory_answer"]);expect(requests[2].tool_choice).toBe("required");
 });
 it("permits mixed-chat submission after a penultimate read without enabling late actions",async()=>{
  const action=vi.fn(async()=>"must not run");
  const requests=wire([{calls:[read]},{calls:[submit,{name:"create_item",input:{input:"late"}}]}]);
  const {answerSupportScope:_,...mixed}=input;
  const result=await llm(2).answer(mixed,tools,undefined,undefined,{create_item:{description:"Create item",run:action}});
  expect(action).not.toHaveBeenCalled();
  expect(result.supportSelections).toEqual([{id,mode:"current"}]);
  expect(requests).toHaveLength(2);expect(requests[1].tool_choice).toBe("auto");
  expect(requests[1].tools.map((t:any)=>t.function.name)).toEqual(["submit_memory_answer"]);
 });
 it("requires submission for host-pinned evidence even without a model read",async()=>{
  const requests=wire([{calls:[submit]}]);const result=await llm().answer({...input,answerSupportRead:true},tools);
  expect(requests[0].tool_choice).toBe("required");expect(result.supportSelections).toHaveLength(1);expect(requests).toHaveLength(1);
 });
 it.each(["**Everyday scale models.**\n\n> A complete quoted teaching approach.", ""])('reports protocol noncompliance for prose/empty final output without a recovery call: %s',async text=>{
  const requests=wire([{calls:[read]},{text}]);const result=await llm().answer(input,tools);
  expect(result).toEqual({text:"",readPaths:[],supportProtocolError:"missing_submission"});expect(requests).toHaveLength(2);expect(result.supportSelections).toBeUndefined();
 });
 it("passes well-shaped unknown IDs and wrong allowed modes to host validation, never inventing authority",async()=>{
  const unknown="as_ffffffffffffffffffffffff";wire([{calls:[read]},{calls:[{...submit,input:{analysisText:null,supportSelections:[{id:unknown,mode:"prior",summaryText:null}]}}]}]);
  expect((await llm().answer(input,tools)).supportSelections).toEqual([{id:unknown,mode:"prior"}]);
 });
 it("fails protocol completion on schema-invalid submission at the budget limit without recovery",async()=>{
  const requests=wire([{calls:[read]},{calls:[{...submit,input:{analysisText:null,supportSelections:[{id:"invented",mode:"current",summaryText:null}]}}]}]);
  const result=await llm(2).answer(input,tools);
  expect(result.supportProtocolError).toBe("missing_submission");expect(result.supportSelections).toBeUndefined();expect(requests).toHaveLength(2);
 });
 it("does not treat duplicate terminal submissions as a valid answer",async()=>{
  wire([{calls:[read]},{calls:[submit,submit]}]);expect((await llm().answer(input,tools)).supportProtocolError).toBe("invalid_submission");
 });
 it("preserves a configured action after reading memory in mixed action scope",async()=>{
  const action=vi.fn(async()=>"CREATED approved item");
  const requests=wire([{calls:[read]},{calls:[{name:"create_item",input:{input:"Use the remembered plan"}}]},{text:"Done."}]);
  const {answerSupportScope:_,...mixed}=input;
  const result=await llm().answer(mixed,tools,undefined,undefined,{create_item:{description:"Create the user-requested item.",authoritativeReadResult:true,run:action}});
  expect(requests[1].tools.map((t:any)=>t.function.name)).toContain("create_item");
  expect(action).toHaveBeenCalledOnce();expect(result.text).toBe("CREATED approved item");expect(result.supportProtocolError).toBeUndefined();
 });
 it("enforces explicit memory-only execution scope even if a provider emits an unadvertised action",async()=>{
  const action=vi.fn(async()=>"must not run");
  const requests=wire([{calls:[read]},{calls:[submit,{name:"create_item",input:{input:"unrequested"}}]}]);
  const result=await llm().answer(input,tools,undefined,undefined,{create_item:{description:"Create item.",run:action}});
  expect(requests[1].tools.map((t:any)=>t.function.name)).not.toContain("create_item");
  expect(action).not.toHaveBeenCalled();expect(result.supportSelections).toHaveLength(1);
 });
 it("rejects an unadvertised submit paired with the first read whose output the model has not seen",async()=>{
  const requests=wire([{calls:[read,submit]}]);
  expect((await llm().answer(input,tools)).supportProtocolError).toBe("invalid_submission");
  expect(requests[0].tools.map((t:any)=>t.function.name)).not.toContain("submit_memory_answer");expect(requests).toHaveLength(1);
 });
 it("finishes a terminal and bounded read batch without another model step",async()=>{
  const requests=wire([{calls:[read]},{calls:[submit,read]}]);
  const result=await llm().answer(input,tools);expect(result.supportSelections).toHaveLength(1);expect(requests).toHaveLength(2);
 });
 it("keeps ordinary prose and user-requested JSON compatible without a memory read",async()=>{
  for(const text of ["Hello!",'{"ordinary":"requested JSON"}']){const requests=wire([{text}]);expect((await llm().answer(input,tools)).text).toBe(text);expect(requests).toHaveLength(1)}
 });
});

it('advertises exclusive seek/continuation and completes a valid continuation within existing rounds',async()=>{
 const path='Log/2026-09-01.md', cursor='host-next-cursor';
 const readNote=vi.fn(async(_path:string,options:any)=>{
  if(options.cursor){expect(options.query).toBeUndefined();expect(options.cursor).toBe(cursor);return JSON.stringify({body:'Complete teaching proposition.',answerSupports:[{id,modes:['raw_report']}]})}
  return JSON.stringify({body:'# Daily log',queryMatched:false,nextCursor:cursor,answerSupports:[],readPartial:true});
 });
 const requests=wire([{calls:[{name:'read_note',input:{path,query:'nonliteral terms'}}]},{calls:[{name:'read_note',input:{path,cursor:'cursor_1'}}]},{calls:[{name:'submit_memory_answer',input:{analysisText:null,supportSelections:[{id,mode:'raw_report',summaryText:null}]}}]}]);
 const result=await llm(3).answer(input,{searchChats:async()=>'',searchVault:async()=>'',listPages:async()=>'',readNote});
 expect(result.supportSelections).toEqual([{id,mode:'raw_report'}]);expect(requests).toHaveLength(3);expect(readNote).toHaveBeenCalledTimes(2);
 const advertised=requests[0].tools.find((t:any)=>t.function.name==='read_note').function;
 expect(advertised.description).toContain('Never send query and cursor together');
 expect(advertised.parameters.properties.cursor.description).toContain('omit query');
 expect(advertised.parameters.properties.query.description).toContain('omit cursor');
});

it("submits a cited summary after reading beginning, middle and end of a long latest voice note",async()=>{
 const ref="Log/2026-09-14.md#^e-123abc";
 const raw="Quizá alquile; no he decidido.\n"+"We are considering alternatives. ".repeat(270)+"\nBudget remains unknown.\n"+"Todavía tengo dudas. ".repeat(400)+"\nI will inspect before deciding.";
 expect(raw.length).toBeGreaterThan(17000);
 const chunks=[raw.slice(0,6000),raw.slice(6000,12000),raw.slice(12000)];
 const summaryText="Partial source summary: renting remains tentative; the budget is unknown and inspection precedes any decision.";
 const requests=wire([
  {calls:[{name:"read_note",input:{path:ref}}]},
  {calls:[{name:"read_note",input:{path:ref,cursor:"cursor_1"}}]},
  {calls:[{name:"read_note",input:{path:ref,cursor:"cursor_2"}}]},
  {calls:[{name:"submit_memory_answer",input:{analysisText:null,supportSelections:[{id,mode:"raw_report",summaryText}]}}]},
 ]);
 const seen:string[]=[];
 const result=await llm(5).answer({...input,question:"Summarize my latest voice note about the decision."},{searchChats:tools.searchChats,searchVault:async()=>"unused",readNote:async(_path:string,options:any={})=>{
  const n=options.cursor==="middle"?1:options.cursor==="end"?2:0;seen.push(chunks[n]!);
  return JSON.stringify({body:chunks[n],identity:ref,answerSupports:[{id,modes:["raw_report"]}],nextCursor:n===0?"middle":n===1?"end":null});
 },searchEntries:async()=>JSON.stringify({entries:[]})});
 expect(seen.join("")).toBe(raw);expect(requests).toHaveLength(4);
 expect(result.supportSelections?.[0]?.summaryText).toBe(summaryText);
 const system=JSON.stringify(requests[0].messages);
 expect(system).toContain("chronological order and count FIRST");
 expect(system).toContain("covering beginning, middle and end");
 expect(system).toContain("Always include summaryText in the model submission");
 expect(system).toContain("Preserve ambiguous numbers as ambiguous");
 expect(system).toContain("Use a few complete relevant supports while retaining all requested subjects");
 const terminal=requests.at(-1).tools.find((t:any)=>t.function.name==="submit_memory_answer").function;
 expect(terminal.description).toContain("write concise summaryText");
 expect(terminal.description).toContain("does not summarize");
 const selection=terminal.parameters.properties.supportSelections.items;
 expect(selection.properties.summaryText.description).toContain("Always provide summaryText");
 // The model must choose text or null; internal selections remain compatible.
 expect(selection.required).toEqual(["id","mode","summaryText"]);
 const search=requests[0].tools.find((t:any)=>t.function.name==="search_entries").function;
 expect(search.description).toContain("identify it FIRST with contentType, order=newest and limit=1, without query");
 expect(search.parameters.properties.query.description).toContain("Omit when first identifying a referenced latest item");
});

it.each([undefined,"", " ", "x".repeat(1201)])('rejects an omitted or invalid model summary choice without another round: %s',async summaryText=>{
 const selection={id,mode:'raw_report',...(summaryText===undefined?{}:{summaryText})};
 const requests=wire([{calls:[read]},{calls:[{name:'submit_memory_answer',input:{analysisText:null,supportSelections:[selection]}}]}]);
 const result=await llm(2).answer(input,tools);
 expect(result.supportProtocolError).toBe('missing_submission');expect(result.supportSelections).toBeUndefined();expect(requests).toHaveLength(2);
});
it.each([null,'The speaker may rent; this is not decided.'])('normalizes an explicit model summary choice at the adapter boundary: %s',async summaryText=>{
 const requests=wire([{calls:[read]},{calls:[{name:'submit_memory_answer',input:{analysisText:null,supportSelections:[{id,mode:'raw_report',summaryText}]}}]}]);
 const result=await llm(2).answer(input,tools);
 expect(result.supportSelections).toEqual([{id,mode:'raw_report',...(summaryText===null?{}:{summaryText})}]);
 const schema=requests[1].tools.find((t:any)=>t.function.name==='submit_memory_answer').function.parameters.properties.supportSelections.items;
 expect(schema.required).toContain('summaryText');expect(schema.properties.summaryText.anyOf).toContainEqual({type:'null'});
});

it("reads an entire17k source through short aliases before selecting its summary-only handle",async()=>{
 const registry=new AnswerSupportRegistry(),ref="Log/2026-09-15.md#^e-123abc";
 const raw="## Capture ^e-123abc\n\n> "+"A tentative option remains conditional on inspection. ".repeat(340);
 const count=Math.ceil(raw.length/4000);let summaryId="";const seen:string[]=[];
 const replies: Array<Reply|(()=>Reply)>=Array.from({length:count},(_,i)=>({calls:[{name:"read_note",input:{path:ref,...(i?{cursor:`cursor_${i}`}:{})}}]}));
 replies.push(()=>({calls:[{name:"submit_memory_answer",input:{analysisText:null,supportSelections:[{id:summaryId,mode:"raw_report",summaryText:"The speaker is considering an option conditional on inspection."}]}}]}));
 const requests=wire(replies);
 const result=await llm(8).answer(input,{searchChats:async()=>"",searchVault:async()=>"",readNote:async(path,options:any={})=>{
  expect(path).toBe(ref);const start=options.cursor?Number(options.cursor.slice("private-cursor-".length)):0,end=Math.min(start+4000,raw.length);seen.push(raw.slice(start,end));
  const passage:NotePassage={source:{path:ref.split("#")[0]!,provider:"github"},readPath:ref,identity:ref,version:"v1",part:"body",frontmatterChars:0,body:raw.slice(start,end),extent:{unit:"utf16",start,end,total:raw.length,scopeStart:0,scopeEnd:raw.length,sectionStart:0,sectionEnd:raw.length},truncated:end<raw.length,omittedBefore:start>0,nextCursor:end<raw.length?`private-cursor-${end}`:null};
  const hints=registry.addPassage(passage);const summary=hints.find(h=>h.kind==="source_summary");if(summary)summaryId=summary.id;
  expect(!!summary).toBe(end===raw.length);return JSON.stringify({...passage,answerSupports:hints});
 }});
 expect(raw.length).toBeGreaterThan(17000);expect(seen.join("")).toBe(raw);expect(requests).toHaveLength(count+1);
 expect(JSON.stringify(requests)).not.toContain("private-cursor-");expect(summaryId).not.toBe("");
 expect(registry.render(result.supportSelections!).valid).toBe(true);
 expect(registry.selectedPassages(result.supportSelections!)[0]!.version).toBe("v1");
});

it.each(['unknown','wrong-source','stale'])('keeps cursor scope/version failures fail-closed through actual SDK: %s',async failure=>{
 const ref='Log/2026-09-15.md#^e-123abc';
 const readNote=vi.fn(async(path:string,options:any={})=>{
  if(options.cursor){expect(path).toBe(ref);expect(options.cursor).toBe('private-stale-cursor');throw new Error('Source snapshot changed; restart read');}
  return JSON.stringify({body:'Only the first portion.',nextCursor:'private-stale-cursor',answerSupports:[]});
 });
 const requests=wire([{calls:[{name:'read_note',input:{path:ref}}]},
  {calls:[{name:'read_note',input:{path:failure==='wrong-source'?'Log/2026-09-15.md#^e-abcdef':ref,cursor:failure==='unknown'?'cursor_99':'cursor_1'}}]},
  {calls:[{name:'submit_memory_answer',input:{analysisText:null,supportSelections:[]}}]}]);
 const result=await llm(3).answer(input,{searchChats:async()=>'',searchVault:async()=>'',readNote});
 expect(readNote).toHaveBeenCalledTimes(failure==='stale'?2:1);expect(result.supportSelections).toEqual([]);expect(requests).toHaveLength(3);
 expect(JSON.stringify(requests.at(-1).messages)).toContain(failure==='stale'?'Source snapshot changed':'Unknown cursor');
});


it("submits bounded grounded analysis as a distinct field through the real SDK",async()=>{
 const analysisText="I would first confirm repair feasibility; the quoted cost favors repair only if the technician can do it.";
 const requests=wire([{calls:[read]},{calls:[{name:"submit_memory_answer",input:{analysisText,supportSelections:[{id,mode:"current",summaryText:null}]}}]}]);
 const result=await llm().answer(input,tools);
 expect(result.analysisText).toBe(analysisText);expect(result.supportSelections).toEqual([{id,mode:"current"}]);
 const schema=requests[1].tools.find((t:any)=>t.function.name==="submit_memory_answer").function.parameters;
 expect(schema.required).toContain("analysisText");expect(schema.properties.analysisText.anyOf).toContainEqual({type:"null"});
 expect(requests).toHaveLength(2);
});
it.each(["", " ", "x".repeat(1601)])("rejects invalid assessment text without extra completion",async analysisText=>{
 const requests=wire([{calls:[read]},{calls:[{name:"submit_memory_answer",input:{analysisText,supportSelections:[{id,mode:"current",summaryText:null}]}}]}]);
 const result=await llm(2).answer(input,tools);expect(result.supportProtocolError).toBe("missing_submission");expect(result.analysisText).toBeUndefined();expect(requests).toHaveLength(2);
});


it("continues a partial whole-source packet using its exact returned readPath and aliased cursor",async()=>{
 const daily="Log/2026-09-15.md",ref=daily+"#^e-123abc";
 const readNote=vi.fn(async(path:string,options:any={})=>{
  if(options.completeSource){expect(path).toBe(daily);expect(options.query).toBe("source locator");return JSON.stringify({readPath:ref,identity:ref,part:"body",readPartial:true,passages:[{readPath:ref,body:"Beginning",answerSupports:[{id,modes:["raw_report"]}]}],nextCursor:"private-exact-source-cursor"});}
  expect(path).toBe(ref);expect(options.cursor).toBe("private-exact-source-cursor");expect(options.completeSource).toBeUndefined();
  return JSON.stringify({readPath:ref,body:"Ending",nextCursor:null,answerSupports:[{id,modes:["raw_report"]}]});
 });
 const requests=wire([{calls:[{name:"read_note",input:{path:daily,query:"source locator",completeSource:true}}]},
  {calls:[{name:"read_note",input:{path:ref,cursor:"cursor_1"}}]},
  {calls:[{name:"submit_memory_answer",input:{analysisText:null,supportSelections:[{id,mode:"raw_report",summaryText:"A concise source summary."}]}}]}]);
 const result=await llm().answer(input,{...tools,searchVault:async()=>"",readNote});
 expect(result.supportSelections?.[0]?.summaryText).toBe("A concise source summary.");expect(readNote).toHaveBeenCalledTimes(2);expect(requests).toHaveLength(3);
 expect(JSON.stringify(requests)).not.toContain("private-exact-source-cursor");
});
