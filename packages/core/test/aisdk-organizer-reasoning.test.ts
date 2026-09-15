import {afterEach,expect,it,vi} from 'vitest';
const control=vi.hoisted(()=>({signal:undefined as AbortSignal|undefined}));
vi.mock('ai',async importActual=>{
 const actual=await importActual<typeof import('ai')>();
 return {...actual,generateObject:(args:any)=>actual.generateObject({...args,...(control.signal?{abortSignal:control.signal}:{})})};
});
import {createBrainLlm} from '../src/llm/aisdk.js';
const classified={passageReviews:[],topics:[{topic:'Synthetic',facts:[],evidenceQuotes:['Synthetic proposition.'],evidenceAssignments:[],confidence:1,disposition:'evidence_only',pages:[],summary:'Synthetic',question:null}],disposition:'evidence_only',confidence:1,summary:'Synthetic',tags:[],pages:[],question:null};
afterEach(()=>{control.signal=undefined;vi.unstubAllGlobals();});
function transport(classificationResponse:unknown=classified,reconciliationResponse:unknown={operations:[]}) {
 const requests:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:unknown,init:RequestInit)=>{
  expect(String(url)).toBe('https://openrouter.ai/api/v1/chat/completions');
  const request=JSON.parse(String(init.body));requests.push(request);
  const system=JSON.stringify(request.messages);
  const content=system.includes('Classify an incoming memory')?JSON.stringify(classificationResponse):system.includes('incremental memory librarian')?JSON.stringify(reconciliationResponse):system.includes('backlog/action digester')?JSON.stringify({candidates:[]}):'Synthetic answer.';
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
 expect(requests[0].max_tokens).toBe(effort === 'low' ? 16384 : 8192);expect(requests[1].max_tokens).toBe(effort === 'low' ? 8192 : 4000);
 // Other stages keep their existing independent output budgets.
 expect(requests[2]).not.toHaveProperty('max_tokens');
 expect(requests[3]).not.toHaveProperty('max_tokens');
 expect(requests[4].max_tokens).toBe(4096);
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

it('emits strict-compatible anyOf for mutually exclusive reconciliation kinds on the actual wire',async()=>{
 const requests=transport();const llm=createBrainLlm({provider:'openrouter',apiKey:'offline-unused'});
 await llm.reconcile!({path:'Notes/Test.md',revision:'test',contextPartial:false,statements:[],sources:[],ideas:[]});
 const schema=requests[0].response_format.json_schema.schema;
 expect(JSON.stringify(schema)).not.toContain('"oneOf"');
 const branches=schema.properties.operations.items.anyOf;
 expect(branches).toHaveLength(4);
 expect(branches.map((branch:any)=>branch.properties.kind.const)).toEqual(['link_source','supersede','conflict','clarify']);
 for(const branch of branches){expect(branch.additionalProperties).toBe(false);expect(branch.required.sort()).toEqual(Object.keys(branch.properties).sort());}
});

it('requires explicit retry IDs only on corrective classification and preserves the existing wire budget',async()=>{
 const retryTopic={...classified.topics[0]!,retryId:'owned-decision'};
 const requests=transport({...classified,topics:[retryTopic]});const llm=createBrainLlm({provider:'openrouter',apiKey:'offline-unused'});
 const result=await llm.classify({content:'Synthetic proposition.',pageIndex:[],hints:[],tagVocabulary:[],retryDecisions:[{id:'owned-decision',scope:'decision',reason:'classification_source_address_invalid',topic:{...classified.topics[0]!,question:undefined} as any}]});
 expect(result.topics![0]!.retryId).toBe('owned-decision');expect(requests).toHaveLength(1);expect(requests[0].max_tokens).toBe(8192);
 const item=requests[0].response_format.json_schema.schema.properties.topics.items;
 expect(item.required).toContain('retryId');expect(item.additionalProperties).toBe(false);
 const prompt=JSON.stringify(requests[0].messages);expect(prompt).toContain('Accepted siblings are already retained');expect(prompt).toContain('scope=source_window');expect(prompt).toContain('owned-decision');
});

 it('constrains ADD to offered candidate IDs on the actual SDK wire and rejects old context selectors',async()=>{
  const {prepareReconciliation,applyReconciliation}=await import('../src/engine/reconciliation.js');
  const text='Only if approved, Mina checks the drain.';
  const prepared=prepareReconciliation({path:'Notes/Test.md',raw:null,title:'Test',type:'note',today:'2026-09-15',sourceContent:text,
   evidence:{content:text,evidenceRef:'Log/2026-09-15.md#^e-123abc'} as any,sources:[{id:'context',start:0,end:text.length,text}],ideas:[{id:'idea',topic:'Conditional check',sourceIds:['context']}],
   addCandidates:[{id:'candidate',ideaIds:['idea'],start:0,end:text.length,text}],context:{branches:[],partial:false,omitted:[],omittedCount:0,contextChars:0,estimatedTokens:0},links:[]});
  const base={kind:'add',ideaIds:['idea'],sourceIds:['candidate'],sourceQuote:'-',targetId:null,factKey:null,correctionQuote:null,reason:null};
  const requests=transport(classified,{operations:[base]});const llm=createBrainLlm({provider:'openrouter',apiKey:'offline-unused'});
  const result=await llm.reconcile!(prepared.request);
  const schema=requests[0].response_format.json_schema.schema;
  const branches=schema.properties.operations.items.anyOf,add=branches.find((b:any)=>b.properties.kind.const==='add');
  expect(add.properties.sourceIds.items.enum).toEqual(['candidate']);expect(add.properties.sourceQuote.const).toBe('-');
  expect(branches.find((b:any)=>b.properties.kind.const==='link_source').properties.sourceIds.items).toEqual({type:'string'});
  expect(JSON.stringify(schema)).not.toContain('"oneOf"');
  const applied=await applyReconciliation(prepared,result);expect(applied.pending).toEqual([]);expect(applied.content).toContain(text);
  transport(classified,{operations:[{...base,sourceIds:['context'],sourceQuote:text}]});
  await expect(llm.reconcile!(prepared.request)).rejects.toThrow('reconciliation_unavailable');
  const empty=transport(classified,{operations:[{...base,kind:'clarify',sourceIds:['context'],sourceQuote:text,reason:'No complete candidate'}]});
  await expect(llm.reconcile!({...prepared.request,addCandidates:[]})).resolves.toMatchObject([{kind:'clarify'}]);
  expect(empty[0].response_format.json_schema.schema.properties.operations.items.anyOf.map((b:any)=>b.properties.kind.const)).not.toContain('add');
 });
