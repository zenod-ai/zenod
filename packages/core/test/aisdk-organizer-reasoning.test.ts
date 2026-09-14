import {afterEach,expect,it,vi} from 'vitest';
const control=vi.hoisted(()=>({signal:undefined as AbortSignal|undefined}));
vi.mock('ai',async importActual=>{
 const actual=await importActual<typeof import('ai')>();
 return {...actual,generateObject:(args:any)=>actual.generateObject({...args,...(control.signal?{abortSignal:control.signal}:{})})};
});
import {createBrainLlm} from '../src/llm/aisdk.js';
const classified={passageReviews:[],topics:[{topic:'Synthetic',facts:[],evidenceQuotes:['Synthetic proposition.'],evidenceAssignments:[],confidence:1,disposition:'evidence_only',pages:[],summary:'Synthetic',question:null}],disposition:'evidence_only',confidence:1,summary:'Synthetic',tags:[],pages:[],question:null};
afterEach(()=>{control.signal=undefined;vi.unstubAllGlobals();});
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
it.each([undefined,'low','none'].flatMap(effort=>[undefined,['fireworks'],['fireworks','together']].map(order=>({effort,order}))))('actual SDK isolates organizer configuration $effort / $order with shared model IDs',async ({effort,order})=>{
 const requests=transport();
 const llm=createBrainLlm({provider:'openrouter',apiKey:'offline-unused',classifyModel:'synthetic/shared',askModel:'synthetic/shared',organizerReasoningEffort:effort as any,organizerProviderOrder:order});
 await llm.classify({content:'Synthetic proposition.',context:'',pageIndex:[],hints:[],tagVocabulary:[]});
 await llm.reconcile!({path:'Notes/Test.md',revision:'test',contextPartial:false,statements:[],sources:[],ideas:[]});
 await llm.extractBacklog!({content:'Synthetic action.',sourceRefs:[]});
 await llm.composePage({path:'Notes/Test.md',currentContent:null,template:'',evidenceEntry:'Synthetic.',citation:'test',classification:classified,tagVocabulary:[],today:'2026-09-15',requiredType:'note',linkHints:[]});
 await llm.answer({question:'Say hello.',vaultBriefing:'',conversation:[]},{searchChats:async()=>''});
 expect(requests).toHaveLength(5);
 for(const request of requests.slice(0,3)) {
  expect(request.reasoning_effort).toBe(effort);
  expect(request.provider).toEqual(order?{only:order,order,require_parameters:true}:undefined);
  expect(request.response_format.type).toBe('json_schema');expect(request.response_format.json_schema.strict).toBe(true);
 }
 expect(requests[0].max_tokens).toBe(8192);expect(requests[1].max_tokens).toBe(4000);
 for(const request of requests.slice(3)){expect(request).not.toHaveProperty('reasoning_effort');expect(request).not.toHaveProperty('provider');}
 expect(requests.every(request=>request.model==='synthetic/shared')).toBe(true);
});
it('rejects unsupported effort or provider before transport',()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 for(const effort of ['medium','high','',null])expect(()=>createBrainLlm({provider:'openrouter',apiKey:'offline',organizerReasoningEffort:effort as any})).toThrow(/Organizer reasoning effort/);
 for(const provider of ['anthropic','groq'] as const)expect(()=>createBrainLlm({provider,apiKey:'offline',organizerReasoningEffort:'low'})).toThrow(/Organizer reasoning effort/);
 expect(fetch).not.toHaveBeenCalled();
});

it('rejects malformed or non-OpenRouter routing before transport',()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 for(const order of [[],['fireworks','fireworks'],['fireworks','together','wafer','other'],['fireworks/priority'],['fireworks:nitro'],[''],['fireworks,wafer'],[null]])expect(()=>createBrainLlm({provider:'openrouter',apiKey:'offline',organizerProviderOrder:order as any})).toThrow(/Organizer provider order/);
 for(const provider of ['anthropic','openai','groq'] as const)expect(()=>createBrainLlm({provider,apiKey:'offline',organizerProviderOrder:['fireworks']})).toThrow(/Organizer provider order/);
 expect(fetch).not.toHaveBeenCalled();
});

it('routing changes only its envelope and delegates to the current globally intercepted fetch',async()=>{
 const input={content:'Synthetic proposition.',context:'',pageIndex:[],hints:[],tagVocabulary:[]};
 const options={provider:'openrouter' as const,apiKey:'offline-unused',classifyModel:'synthetic/shared',organizerReasoningEffort:'none' as const};
 const plain=createBrainLlm(options),routed=createBrainLlm({...options,organizerProviderOrder:['fireworks']});
 // Install after factories exist: evaluation interception must not be captured early.
 const requests=transport();
 await plain.classify(input);await routed.classify(input);
 const {provider,...other}=requests[1];
 expect(other).toEqual(requests[0]);expect(provider).toEqual({only:['fireworks'],order:['fireworks'],require_parameters:true});
});

it('preserves SDK authorization/content headers and abort propagation through the routing seam',async()=>{
 const controller=new AbortController();control.signal=controller.signal;
 let received!:AbortSignal;
 let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
 const fetch=vi.fn(async(_url:unknown,init:RequestInit)=>{
  expect(new Headers(init.headers).get('authorization')).toBe('Bearer offline-unused');
  expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  received=init.signal!;started();
  return new Promise<Response>((_,reject)=>received.addEventListener('abort',()=>reject(received.reason),{once:true}));
 });vi.stubGlobal('fetch',fetch);
 const llm=createBrainLlm({provider:'openrouter',apiKey:'offline-unused',organizerProviderOrder:['together']});
 const pending=llm.classify({content:'Synthetic proposition.',context:'',pageIndex:[],hints:[],tagVocabulary:[]});
 const rejection=expect(pending).rejects.toBeDefined();
 await ready;controller.abort(new Error('synthetic cancellation'));await rejection;
 expect(received.aborted).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);
});
