import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetLedger,terminalProviderGuard,evaluationFetch,evaluationCostSummary,evaluationCompletion,runEvaluationRecalls} from './policy.mjs';
const prices={model:{inputUsdPerMillion:0.3,outputUsdPerMillion:1.2,maxOutputTokens:1000}};
const request=()=>new Request('https://openrouter.ai/api/v1/chat/completions',{method:'POST',body:JSON.stringify({model:'model',max_tokens:1000,messages:[]})});
const denial=()=>new Response(JSON.stringify({error:{code:403,message:'Key limit exceeded (monthly limit). Manage it using https://example.invalid/keys/private-key-identifier'}}),{status:403});
function setup(stage,fetchImpl,callbacks={}) {
 const ledger=budgetLedger({budgetUsd:1,maxRequests:80,prices}),quota=terminalProviderGuard();
 return {ledger,quota,fetch:evaluationFetch({ledger,quota,fetchImpl,stage:()=>stage,...callbacks})};
}
for(const stage of ['classify','reconcile','answer'])test(`terminal quota in ${stage} blocks SDK and queued retry transports without discarding reservation`,async()=>{
 let sent=0,privateResponse;
 const h=setup(stage,async()=>{sent++;return denial();},{onResponse:async(_row,text)=>{privateResponse=text;}});
 const first=await h.fetch(request());
 assert.equal(first.status,403);assert.match(await first.text(),/evaluation_provider_quota_exhausted/);
 assert.match(privateResponse,/private-key-identifier/); // Wire evidence remains private; no headers captured.
 for(let attempt=0;attempt<5;attempt++)await assert.rejects(()=>h.fetch(request()),{name:'EvaluationProviderQuotaError',message:'evaluation_provider_quota_exhausted'});
 assert.equal(sent,1);assert.equal(h.ledger.rows.length,1);assert.equal(h.ledger.rows[0].status,'failed');
 const summary={...evaluationCompletion({quota:h.quota,recalls:[],plannedRecalls:18}),...evaluationCostSummary(h.ledger)};
 assert.equal(summary.status,'INCOMPLETE_PROVIDER_QUOTA');assert.equal(summary.providerQuota.stage,stage);
 assert.equal(summary.providerReportedCostUsd,0);assert.ok(summary.retainedUnknownCostReservationsUsd>0);
 assert.equal(summary.exposureUsd,h.ledger.rows[0].reservedUsd);
 assert.doesNotMatch(JSON.stringify(summary),/https:|private-key-identifier|Manage it/);
});

test('first quota during recalls preserves observed answer, one failed trial, and unstarted count',async()=>{
 let sent=0;
 const h=setup('answer',async()=>++sent===1?new Response(JSON.stringify({usage:{cost:0.0001}})):denial());
 const recalls=[];
 await runEvaluationRecalls({questions:[{id:'a',question:'first'},{id:'b',question:'second'}],quota:h.quota,recalls,runTrial:async()=>{
   const response=await h.fetch(request());if(!response.ok)throw new Error('provider denied');return {answer:{text:'Observed supported answer'}};
 }});
 assert.equal(sent,2);assert.equal(recalls.length,2);assert.equal(recalls[0].answer.text,'Observed supported answer');assert.equal(recalls[1].semanticVerdict,'FAILED_CALL');
 const completion=evaluationCompletion({quota:h.quota,recalls,plannedRecalls:6});
 assert.deepEqual(completion.recallCoverage,{planned:6,attempted:2,completed:1,failed:1,notStarted:4});
 assert.equal(completion.status,'INCOMPLETE_PROVIDER_QUOTA');
 const costs=evaluationCostSummary(h.ledger);assert.equal(costs.providerReportedCostUsd,0.0001);assert.equal(costs.retainedUnknownCostReservationsUsd,h.ledger.rows[1].reservedUsd);
 assert.ok(Math.abs(costs.exposureUsd-costs.providerReportedCostUsd-costs.retainedUnknownCostReservationsUsd)<1e-12);
});

test('latched classification/reconciliation quota prevents every recall callback',async()=>{
 const h=setup('reconcile',async()=>denial());await h.fetch(request());let callbacks=0;const recalls=[];
 await runEvaluationRecalls({questions:[{id:'a',question:'must not run'}],quota:h.quota,recalls,runTrial:async()=>{callbacks++;return {answer:{}};}});
 assert.equal(callbacks,0);assert.deepEqual(recalls,[]);
 assert.equal(evaluationCompletion({quota:h.quota,recalls,plannedRecalls:3}).recallCoverage.notStarted,3);
});

test('queued request waiting on artifact persistence cannot enter transport after quota latch',async()=>{
 let release,waiting;const held=new Promise(resolve=>{release=resolve;});const ready=new Promise(resolve=>{waiting=resolve;});let sent=0;
 const h=setup('classify',async()=>{sent++;return denial();},{onRequest:async row=>{if(row.request===2){waiting();await held;}}});
 // Hold first response until second request has reserved but has not sent.
 h.fetch= evaluationFetch({ledger:h.ledger,quota:h.quota,stage:()=> 'classify',fetchImpl:async()=>{sent++;await ready;return denial();},onRequest:async row=>{if(row.request===2){waiting();await held;}}});
 const first=h.fetch(request());const second=h.fetch(request());await first;release();
 await assert.rejects(second,/evaluation_provider_quota_exhausted/);assert.equal(sent,1);
});

test('unrelated 403 or malformed error does not masquerade as quota exhaustion',async()=>{
 for(const body of ['not json',JSON.stringify({error:{message:'Access forbidden'}}),JSON.stringify({message:'Key limit exceeded'})]){
  const h=setup('answer',async()=>new Response(body,{status:403}));await h.fetch(request());assert.equal(h.quota.terminal,null);
 }
 const guard=terminalProviderGuard();guard.observe(429,JSON.stringify({error:{message:'quota exceeded'}}),{stage:'answer',request:1});assert.equal(guard.terminal,null);
});

test('reported failed cost is retained once even when private artifact persistence fails',async()=>{
 const h=setup('answer',async()=>new Response(JSON.stringify({usage:{cost:0.01},error:{message:'Key limit exceeded'}}),{status:403}),{onResponse:async()=>{throw new Error('disk failure');}});
 await assert.rejects(()=>h.fetch(request()),/disk failure/);
 assert.equal(h.quota.terminal.status,'INCOMPLETE_PROVIDER_QUOTA');assert.ok(Math.abs(h.ledger.exposureUsd-0.01)<1e-12);assert.equal(h.ledger.rows[0].actualCostUsd,0.01);
});

test('incomplete quota, budget and ordinary call failure cannot report awaiting semantic review',()=>{
 const quota=terminalProviderGuard();
 assert.equal(evaluationCompletion({quota,recalls:[],plannedRecalls:3,budgetBlocks:[{}]}).status,'INCOMPLETE_BUDGET');
 assert.equal(evaluationCompletion({quota,recalls:[{errorClass:'Error'}],plannedRecalls:1}).status,'INCOMPLETE_CALL_FAILURE');
 assert.equal(evaluationCompletion({quota,recalls:[{answer:{}}],plannedRecalls:1}).status,'AWAITING_INDEPENDENT_SEMANTIC_REVIEW');
 assert.equal(evaluationCompletion({quota,recalls:[{answer:{}}],plannedRecalls:1,offline:true}).status,'OFFLINE_PLUMBING_ONLY');
});
