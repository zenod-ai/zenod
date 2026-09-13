import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256, validateFixture, sourceInput, utf16Range, budgetLedger, parseWireUsage, coverageRows, prepareAsrEnvironment} from './policy.mjs';
const fixture = {id:'synthetic', seed_pages:{'Projects/A.md':'# A'}, transcript:'😀 Blue. Red.', ground_truth:[{id:'blue',start:2,end:7,text:'Blue.',operation:'add',page:'Projects/A.md'}]};
const prices={'minimax/minimax-m3':{inputUsdPerMillion:0.30,outputUsdPerMillion:1.20,maxOutputTokens:1000}};
test('freeze fixture, convert codepoints, and exclude ground truth from source input',()=>{
  const bytes=Buffer.from(JSON.stringify(fixture)); assert.deepEqual(validateFixture(bytes,sha256(bytes)),fixture);
  assert.throws(()=>validateFixture(bytes),'hash guard');
  assert.deepEqual(utf16Range(fixture,fixture.ground_truth[0]),{start:3,end:8});
  assert.equal(sourceInput(fixture).content,fixture.transcript);
  assert.equal(Object.hasOwn(sourceInput(fixture),'ground_truth'),false);
  assert.equal(JSON.stringify(sourceInput(fixture)).includes('expectedOperation'),false);
});
test('retains unknown cost reservations and blocks another request before transport',()=>{
  const ledger=budgetLedger({budgetUsd:0.0013,maxRequests:2,prices});
  const row=ledger.reserve({model:'minimax/minimax-m3',max_tokens:1000,messages:[]}); ledger.complete(row,{usage:null},'failed');
  assert.equal(ledger.exposureUsd,row.reservedUsd);assert.throws(()=>ledger.reserve({model:'minimax/minimax-m3',max_tokens:1000,messages:[]}));
});
test('actual costs replace reservation, failed retry and unknown model are bounded',()=>{
  const ledger=budgetLedger({budgetUsd:1,maxRequests:1,prices});
  const row=ledger.reserve({model:'minimax/minimax-m3',max_tokens:1000});ledger.complete(row,{usage:{cost:0.002}},'succeeded');
  assert.equal(ledger.exposureUsd,0.002);assert.throws(()=>ledger.reserve({model:'minimax/minimax-m3',max_tokens:1000}));
  assert.throws(()=>budgetLedger({budgetUsd:1,maxRequests:2,prices}).reserve({model:'unreviewed'}));
});
test('stream usage parsed without headers; missing usage stays unknown',()=>{
  assert.deepEqual(parseWireUsage('data: {"model":"m","usage":{"cost":0.3}}\n\ndata: [DONE]\n'),{model:'m',provider:null,usage:{cost:0.3}});
  assert.equal(parseWireUsage('{}').usage,null);
});
test('span overlap is only structural coverage, never semantic pass',()=>{
  const row=coverageRows(fixture,{topics:[{sourceSpans:[{start:3,end:8}],topic:'unrelated invention'}]})[0];
  assert.equal(row.structurallyAssigned,true);assert.equal(row.semanticVerdict,'REVIEW_REQUIRED');
});

test('wire output cap must be explicit, valid and within reviewed ceiling before reservation',()=>{
  const ledger=budgetLedger({budgetUsd:1,maxRequests:10,prices});
  for (const limits of [{},{max_tokens:null},{max_tokens:0},{max_tokens:1001},{max_completion_tokens:1001},
    {max_tokens:100,max_completion_tokens:1000},{max_tokens:100,max_completion_tokens:null}]) {
    assert.throws(()=>ledger.reserve({model:'minimax/minimax-m3',...limits}));
    assert.equal(ledger.rows.length,0); assert.equal(ledger.exposureUsd,0);
  }
  for (const limits of [{max_tokens:100},{max_completion_tokens:100},{max_tokens:100,max_completion_tokens:100}]) {
    const body={model:'minimax/minimax-m3',...limits}; const before=JSON.stringify(body);
    assert.ok(ledger.reserve(body).reservedUsd>0);assert.equal(JSON.stringify(body),before);
  }
});

test('real ASR rejects simulation hooks and removes credentials before child processes',()=>{
  for(const hook of [{NODE_ENV:'test'},{VITEST:'true'},{VITEST:''},{ZENOD_WHISPER_FAKE_TRANSCRIPT:'pretend speech'},{ZENOD_TRANSCRIPTION_FAKE_FAIL_PROVIDERS:'groq'}]) {
    assert.throws(()=>prepareAsrEnvironment({ZMR_EVAL_OPENROUTER_KEY:'synthetic-test-key',...hook}),/rejects test/);
  }
  const env={NODE_ENV:'production',ZMR_EVAL_OPENROUTER_KEY:'synthetic-test-key',OPENROUTER_API_KEY:'synthetic-cloud',GROQ_API_KEY:'synthetic-groq',OPENAI_API_KEY:'synthetic-openai',PATH:'/synthetic/bin'};
  const key=prepareAsrEnvironment(env);assert.equal(key,'synthetic-test-key');
  assert.deepEqual(env,{NODE_ENV:'production',PATH:'/synthetic/bin'});
  assert.throws(()=>prepareAsrEnvironment({NODE_ENV:'production'}),/Protected evaluation key/);
});
