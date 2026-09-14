import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluationFetch,budgetLedger,terminalProviderGuard,evaluationCompletion,evaluationCostSummary,runEvaluationRecalls} from './policy.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const request=()=>new Request('https://openrouter.ai/api/v1/chat/completions',{method:'POST',body:JSON.stringify({model:'synthetic',max_tokens:10})});
function setup(fetchImpl,callbacks={}) {
 const ledger=budgetLedger({budgetUsd:1,maxRequests:80,prices:{synthetic:{inputUsdPerMillion:1,outputUsdPerMillion:1,maxOutputTokens:10}}}),quota=terminalProviderGuard();
 return {ledger,quota,fetch:evaluationFetch({ledger,quota,fetchImpl,timeoutMs:15,stage:()=> 'classify',...callbacks})};
}
for(const mode of ['transport','body'])test(`deadline terminates noncooperative ${mode}, preserves unknown reservation, and blocks all later transport`,async()=>{
 let signal,sent=0,finish=0;
 const h=setup(async request=>{
  signal=request.signal;sent++;
  return mode==='transport'?new Promise(()=>{}):new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('partial'));}}));
 },{onFinish:async()=>{finish++;}});
 const start=performance.now();
 await assert.rejects(()=>h.fetch(request()),{name:'EvaluationProviderDeadlineError',message:'evaluation_provider_deadline_exceeded'});
 assert.ok(performance.now()-start<500);assert.equal(signal.aborted,true);
 assert.equal(h.ledger.rows[0].status,'failed');assert.equal(h.ledger.rows[0].actualCostUsd,null);assert.equal(finish,1);
 for(let retry=0;retry<3;retry++)await assert.rejects(()=>h.fetch(request()),/evaluation_provider_deadline_exceeded/);
 assert.equal(sent,1);assert.equal(h.ledger.rows.length,1);
 const completion=evaluationCompletion({quota:h.quota,recalls:[],plannedRecalls:18});
 assert.equal(completion.status,'INCOMPLETE_PROVIDER_DEADLINE');assert.equal(completion.providerDeadline.timeoutMs,15);assert.equal(completion.providerQuota,undefined);
 const costs=evaluationCostSummary(h.ledger);assert.equal(costs.exposureUsd,costs.retainedUnknownCostReservationsUsd);
});
for(const mode of ['transport','body'])test(`late ${mode} completion cannot settle usage, publish artifacts or reopen retries`,async()=>{
 let release,sent=0,saved=0;
 const text=JSON.stringify({usage:{cost:0.5}});
 const h=setup(async()=>{
  sent++;
  if(mode==='transport')return new Promise(resolve=>{release=()=>resolve(new Response(text));});
  return new Response(new ReadableStream({start(controller){release=()=>{controller.enqueue(new TextEncoder().encode(text));controller.close();};}}));
 },{onResponse:async()=>{saved++;}});
 await assert.rejects(()=>h.fetch(request()),/evaluation_provider_deadline_exceeded/);
 const snapshot=JSON.stringify({rows:h.ledger.rows,exposure:h.ledger.exposureUsd});
 release();await pause(30);
 assert.equal(JSON.stringify({rows:h.ledger.rows,exposure:h.ledger.exposureUsd}),snapshot);assert.equal(saved,0);
 await assert.rejects(()=>h.fetch(request()),/evaluation_provider_deadline_exceeded/);assert.equal(sent,1);
});
test('deadline stops remaining trials and retains only the observed failed attempt',async()=>{
 const h=setup(()=>new Promise(()=>{}));const recalls=[];
 await runEvaluationRecalls({questions:[{id:'one',question:'probe'},{id:'two',question:'probe'}],quota:h.quota,recalls,runTrial:async()=>({answer:await h.fetch(request())})});
 assert.equal(recalls.length,1);
 assert.deepEqual(evaluationCompletion({quota:h.quota,recalls,plannedRecalls:6}).recallCoverage,{planned:6,attempted:1,completed:0,failed:1,notStarted:5});
});
test('successful complete body clears its deadline and keeps known cost',async()=>{
 const h=setup(async()=>new Response(JSON.stringify({usage:{cost:0.00001}})));
 await h.fetch(request());await pause(30);
 assert.equal(h.quota.terminal,null);assert.equal(h.ledger.rows[0].actualCostUsd,0.00001);
});
test('deadline injection may shorten but never remove or increase the two-minute cap',()=>{
 for(const timeoutMs of [0,-1,120001,Infinity,NaN])assert.throws(()=>evaluationFetch({timeoutMs}),/deadline/);
});
