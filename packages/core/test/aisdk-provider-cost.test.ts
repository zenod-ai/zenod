import {afterEach,expect,it,vi} from 'vitest';
import {createBrainLlm} from '../src/llm/aisdk.js';

const classified={passageReviews:[],topics:[{topic:'Synthetic',facts:[],evidenceQuotes:['Synthetic proposition.'],evidenceAssignments:[],confidence:1,disposition:'evidence_only',pages:[],summary:'Synthetic',question:null}],disposition:'evidence_only',confidence:1,summary:'Synthetic',tags:[],pages:[],question:null};
afterEach(()=>vi.unstubAllGlobals());

it('requests usage.include and records the gateway cost plus generation id for OpenRouter',async()=>{
 const reports:any[]=[];let requestBody:any;
 vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init:RequestInit)=>{
  requestBody=JSON.parse(String(init.body));
  return new Response(JSON.stringify({id:'gen-test-1',object:'chat.completion',created:0,model:requestBody.model,
   choices:[{index:0,message:{role:'assistant',content:JSON.stringify(classified)},finish_reason:'stop'}],
   usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,cost:0.0012345,prompt_tokens_details:{cached_tokens:40,cache_write_tokens:0}}}),
   {headers:{'content-type':'application/json'}});
 }));
 const llm=createBrainLlm({provider:'openrouter',apiKey:'offline-unused',classifyModel:'synthetic/model',onUsage:(r)=>reports.push(r)});
 await llm.classify({content:'Synthetic proposition.',context:'',pageIndex:[],hints:[],tagVocabulary:[]});
 expect(requestBody.usage).toEqual({include:true});
 expect(reports).toHaveLength(1);
 expect(reports[0].providerCostUsd).toBeCloseTo(0.0012345,9);
 expect(reports[0].generationId).toBe('gen-test-1');
 expect(reports[0].cachedInputTokens).toBe(40);
});

it('combines the usage capture with the organizer provider-routing envelope',async()=>{
 let requestBody:any;
 vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init:RequestInit)=>{
  requestBody=JSON.parse(String(init.body));
  return new Response(JSON.stringify({id:'gen-route',object:'chat.completion',created:0,model:requestBody.model,
   choices:[{index:0,message:{role:'assistant',content:JSON.stringify(classified)},finish_reason:'stop'}],
   usage:{prompt_tokens:5,completion_tokens:2,total_tokens:7,cost:0.00001}}),{headers:{'content-type':'application/json'}});
 }));
 const llm=createBrainLlm({provider:'openrouter',apiKey:'offline-unused',classifyModel:'synthetic/model',organizerProviderOrder:['fireworks'],onUsage:()=>{}});
 await llm.classify({content:'Synthetic proposition.',context:'',pageIndex:[],hints:[],tagVocabulary:[]});
 expect(requestBody.usage).toEqual({include:true});
 expect(requestBody.provider).toEqual({only:['fireworks'],order:['fireworks'],require_parameters:true});
});
