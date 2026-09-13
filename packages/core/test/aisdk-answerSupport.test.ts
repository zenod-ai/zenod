import { describe, expect, it, vi } from "vitest";
const control=vi.hoisted(()=>({text:"",configs:[] as any[],read:false}));
vi.mock("ai",async importActual=>{const actual=await importActual<typeof import("ai")>();return {...actual,
 generateText:async(config:any)=>{control.configs.push(config);if(control.read)await config.tools.read_facts.execute({path:"Notes/Atlas.md"});return {text:control.text,totalUsage:{},providerMetadata:{}};},
 streamText:(config:any)=>{control.configs.push(config);return {fullStream:(async function*(){if(control.read)await config.tools.read_facts.execute({path:"Notes/Atlas.md"});for(const text of [control.text.slice(0,8),control.text.slice(8)])yield {type:"text-delta",text};})(),totalUsage:Promise.resolve({}),providerMetadata:Promise.resolve({})};},
};});
import { createBrainLlm } from "../src/llm/aisdk.js";
const id="as_0123456789abcdef01234567";
const tools={searchChats:async()=>"none",readFacts:async()=>JSON.stringify({answerSupports:[{id,modes:["current"]}]})};
describe("same-completion answer support protocol",()=>{
 it.each([false,true])("parses selected support without additional calls or protocol leakage (stream=%s)",async streaming=>{
  control.read=true;control.configs=[];control.text=JSON.stringify({text:"Wrong invented wording",supportSelections:[{id,mode:"current"}]});const deltas:string[]=[];
  const llm=createBrainLlm({provider:"anthropic",apiKey:"synthetic"});
  const result=await llm.answer({question:"¿Cuándo empieza?",vaultBriefing:"",conversation:[],answerSupportContract:"v1",...(streaming?{onTextDelta:(text:string)=>deltas.push(text)}:{})},tools);
  expect(result.supportSelections).toEqual([{id,mode:"current"}]);expect(result.text).toBe("");expect(deltas).toEqual([]);expect(control.configs).toHaveLength(1);
 });
 it("keeps ordinary conversation compatible while withholding malformed or missing selection after a support read",async()=>{
  const llm=createBrainLlm({provider:"anthropic",apiKey:"synthetic"});const input={question:"Hello",vaultBriefing:"",conversation:[],answerSupportContract:"v1" as const};
  control.read=false;control.text="Hello!";expect((await llm.answer(input,tools)).text).toBe("Hello!");
  control.text='{"ordinary":"JSON requested by user"}';expect((await llm.answer(input,tools)).text).toBe(control.text);
  control.read=true;control.text="The old date is current.";expect((await llm.answer(input,tools)).text).toBe("");
  control.text='Here is JSON: {"supportSelections":';expect((await llm.answer(input,tools)).text).toBe("");
 });
});
