import test from 'node:test';
import assert from 'node:assert/strict';
import {generateText} from 'ai';
import {createOpenAI} from '@ai-sdk/openai';
import {budgetLedger,terminalProviderGuard,evaluationFetch} from './policy.mjs';

test('actual SDK retries and a later job invocation cannot resend after terminal quota',async()=>{
 const quota=terminalProviderGuard();
 const ledger=budgetLedger({budgetUsd:1,maxRequests:80,prices:{model:{inputUsdPerMillion:0.3,outputUsdPerMillion:1.2,maxOutputTokens:1000}}});
 let sent=0;
 const fetch=evaluationFetch({ledger,quota,stage:()=> 'answer',fetchImpl:async()=>{
  sent++;return new Response(JSON.stringify({error:{message:'Key limit exceeded (monthly limit).'}}),{status:403});
 }});
 const model=createOpenAI({apiKey:'offline-unused',baseURL:'https://openrouter.ai/api/v1',fetch}).chat('model');
 const invoke=()=>generateText({model,prompt:'Synthetic offline retry probe',maxOutputTokens:1000,maxRetries:2});
 await assert.rejects(invoke);await assert.rejects(invoke);
 assert.equal(sent,1);assert.equal(ledger.rows.length,1);
 assert.equal(quota.terminal.status,'INCOMPLETE_PROVIDER_QUOTA');
 assert.equal(ledger.rows[0].actualCostUsd,null);assert.ok(ledger.exposureUsd>0);
});

for(const stage of ['classify','reconcile','answer'])test(`actual SDK cannot retry a noncooperative ${stage} deadline`,async()=>{
 const quota=terminalProviderGuard();
 const ledger=budgetLedger({budgetUsd:1,maxRequests:80,prices:{model:{inputUsdPerMillion:0.3,outputUsdPerMillion:1.2,maxOutputTokens:1000}}});
 let sent=0;
 const fetch=evaluationFetch({ledger,quota,timeoutMs:15,stage:()=>stage,fetchImpl:async()=>{sent++;return new Promise(()=>{});}});
 const model=createOpenAI({apiKey:'offline-unused',baseURL:'https://openrouter.ai/api/v1',fetch}).chat('model');
 const invoke=()=>generateText({model,prompt:'Synthetic deadline test',maxOutputTokens:1000,maxRetries:2});
 await assert.rejects(invoke);await assert.rejects(invoke);
 assert.equal(sent,1);assert.equal(ledger.rows.length,1);assert.equal(quota.terminal.status,'INCOMPLETE_PROVIDER_DEADLINE');
 assert.equal(ledger.rows[0].actualCostUsd,null);assert.ok(ledger.exposureUsd>0);
});
