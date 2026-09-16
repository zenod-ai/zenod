import {afterEach,expect,it,vi} from 'vitest';
import {createBrainLlm} from '../src/llm/aisdk.js';

const classified={passageReviews:[],topics:[{topic:'Synthetic',facts:[],evidenceQuotes:['Synthetic proposition.'],evidenceAssignments:[],confidence:1,disposition:'evidence_only',pages:[],summary:'Synthetic',question:null}],disposition:'evidence_only',confidence:1,summary:'Synthetic',tags:[],pages:[],question:null};
afterEach(()=>vi.unstubAllGlobals());

function transport(){
 const requests:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init:RequestInit)=>{
  const request=JSON.parse(String(init.body));requests.push(request);
  const system=JSON.stringify(request.messages);
  const content=system.includes('Classify an incoming memory')?JSON.stringify(classified):'Synthetic answer.';
  return new Response(JSON.stringify({id:'offline',object:'chat.completion',created:0,model:request.model,choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}),{headers:{'content-type':'application/json'}});
 }));return requests;
}

it('applies the ask-side reasoning effort to ask/answer calls but not to classify',async()=>{
 const requests=transport();
 const llm=createBrainLlm({provider:'openrouter',apiKey:'offline-unused',askModel:'synthetic/ask',classifyModel:'synthetic/classify',askReasoningEffort:'low'});
 await llm.answer({question:'Say hello.',vaultBriefing:'',conversation:[]},{searchChats:async()=>''});
 await llm.classify({content:'Synthetic proposition.',context:'',pageIndex:[],hints:[],tagVocabulary:[]});
 expect(requests).toHaveLength(2);
 expect(requests[0].model).toBe('synthetic/ask');expect(requests[0].reasoning_effort).toBe('low');
 expect(requests[1].model).toBe('synthetic/classify');expect(requests[1]).not.toHaveProperty('reasoning_effort');
});

it('rejects unsupported ask effort or provider before transport',()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 for(const effort of ['medium','high','',null])expect(()=>createBrainLlm({provider:'openrouter',apiKey:'offline',askReasoningEffort:effort as any})).toThrow(/Ask reasoning effort/);
 for(const provider of ['anthropic','groq'] as const)expect(()=>createBrainLlm({provider,apiKey:'offline',askReasoningEffort:'low'})).toThrow(/Ask reasoning effort/);
 expect(fetch).not.toHaveBeenCalled();
});

it('keeps ask-side effort independent from organizer effort',async()=>{
 const requests=transport();
 const llm=createBrainLlm({provider:'openrouter',apiKey:'offline-unused',askModel:'synthetic/ask',classifyModel:'synthetic/classify',askReasoningEffort:'low',organizerReasoningEffort:'none'});
 await llm.answer({question:'Say hello.',vaultBriefing:'',conversation:[]},{searchChats:async()=>''});
 await llm.classify({content:'Synthetic proposition.',context:'',pageIndex:[],hints:[],tagVocabulary:[]});
 expect(requests[0].reasoning_effort).toBe('low');
 expect(requests[1].reasoning_effort).toBe('none');
});
