import {afterEach,expect,it,vi} from 'vitest';
import {createBrainLlm} from '../src/llm/aisdk.js';
const classified={passageReviews:[],topics:[{topic:'Synthetic',facts:[],evidenceQuotes:['Synthetic proposition.'],evidenceAssignments:[],confidence:1,disposition:'evidence_only',pages:[],summary:'Synthetic',question:null}],disposition:'evidence_only',confidence:1,summary:'Synthetic',tags:[],pages:[],question:null};
afterEach(()=>vi.unstubAllGlobals());
function transport() {
 const requests:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:unknown,init:RequestInit)=>{
  expect(String(url)).toBe('https://openrouter.ai/api/v1/chat/completions');
  const request=JSON.parse(String(init.body));requests.push(request);
  const system=JSON.stringify(request.messages);
  const content=system.includes('Classify an incoming memory')?JSON.stringify(classified):system.includes('incremental memory librarian')?JSON.stringify({operations:[]}):system.includes('backlog/action digester')?JSON.stringify({candidates:[]}):'Synthetic answer.';
  return new Response(JSON.stringify({id:'offline',object:'chat.completion',created:0,model:request.model,choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}),{headers:{'content-type':'application/json'}});
 }));return requests;
}
it.each([undefined,'low','none'] as const)('actual SDK sends organizer effort %s only on organizing operations, even with shared model IDs',async effort=>{
 const requests=transport();
 const llm=createBrainLlm({provider:'openrouter',apiKey:'offline-unused',classifyModel:'synthetic/shared',askModel:'synthetic/shared',organizerReasoningEffort:effort});
 await llm.classify({content:'Synthetic proposition.',context:'',pageIndex:[],hints:[],tagVocabulary:[]});
 await llm.reconcile!({path:'Notes/Test.md',revision:'test',contextPartial:false,statements:[],sources:[],ideas:[]});
 await llm.extractBacklog!({content:'Synthetic action.',sourceRefs:[]});
 await llm.composePage({path:'Notes/Test.md',currentContent:null,template:'',evidenceEntry:'Synthetic.',citation:'test',classification:classified,tagVocabulary:[],today:'2026-09-15',requiredType:'note',linkHints:[]});
 await llm.answer({question:'Say hello.',vaultBriefing:'',conversation:[]},{searchChats:async()=>''});
 expect(requests).toHaveLength(5);
 for(const request of requests.slice(0,3)) {
  expect(request.reasoning_effort).toBe(effort);
  expect(request.response_format.type).toBe('json_schema');expect(request.response_format.json_schema.strict).toBe(true);
 }
 expect(requests[0].max_tokens).toBe(8192);expect(requests[1].max_tokens).toBe(4000);
 for(const request of requests.slice(3))expect(request).not.toHaveProperty('reasoning_effort');
 expect(requests.every(request=>request.model==='synthetic/shared')).toBe(true);
});
it('rejects unsupported effort or provider before transport',()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 for(const effort of ['medium','high','',null])expect(()=>createBrainLlm({provider:'openrouter',apiKey:'offline',organizerReasoningEffort:effort as any})).toThrow(/Organizer reasoning effort/);
 for(const provider of ['anthropic','groq'] as const)expect(()=>createBrainLlm({provider,apiKey:'offline',organizerReasoningEffort:'low'})).toThrow(/Organizer reasoning effort/);
 expect(fetch).not.toHaveBeenCalled();
});
