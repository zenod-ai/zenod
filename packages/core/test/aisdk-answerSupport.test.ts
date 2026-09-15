import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrainLlm } from "../src/llm/aisdk.js";
const id="as_0123456789abcdef01234567";
const tools={searchChats:async()=>"none",readFacts:async()=>JSON.stringify({answerSupports:[{id,modes:["current"]}]})};
afterEach(()=>vi.unstubAllGlobals());
type Reply={text?:string;calls?:Array<{name:string;input:unknown}>};
function wire(replies:Reply[]) {
 const requests:any[]=[];
 vi.stubGlobal("fetch",vi.fn(async (url:unknown,init:RequestInit)=>{
  expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
  const request=JSON.parse(String(init.body));requests.push(request);
  const reply=replies[requests.length-1];if(!reply)throw new Error("Unexpected extra model completion");
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
const submit={name:"submit_memory_answer",input:{supportSelections:[{id,mode:"current"}]}};
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
  const requests=wire([{calls:[{name:"search_vault",input:{query:"Atlas"}}]},{calls:[{name:"submit_memory_answer",input:{supportSelections:[]}}]}]);
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
  const unknown="as_ffffffffffffffffffffffff";wire([{calls:[read]},{calls:[{...submit,input:{supportSelections:[{id:unknown,mode:"prior"}]}}]}]);
  expect((await llm().answer(input,tools)).supportSelections).toEqual([{id:unknown,mode:"prior"}]);
 });
 it("fails protocol completion on schema-invalid submission at the budget limit without recovery",async()=>{
  const requests=wire([{calls:[read]},{calls:[{...submit,input:{supportSelections:[{id:"invented",mode:"current"}]}}]}]);
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
 const requests=wire([{calls:[{name:'read_note',input:{path,query:'nonliteral terms'}}]},{calls:[{name:'read_note',input:{path,cursor}}]},{calls:[{name:'submit_memory_answer',input:{supportSelections:[{id,mode:'raw_report'}]}}]}]);
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
  {calls:[{name:"read_note",input:{path:ref,cursor:"middle"}}]},
  {calls:[{name:"read_note",input:{path:ref,cursor:"end"}}]},
  {calls:[{name:"submit_memory_answer",input:{supportSelections:[{id,mode:"raw_report",summaryText}]}}]},
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
});
