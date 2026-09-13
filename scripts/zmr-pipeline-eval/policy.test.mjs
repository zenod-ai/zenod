import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256, validateFixture, sourceInput, utf16Range, budgetLedger, parseWireUsage, coverageRows} from './policy.mjs';
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
  const row=ledger.reserve({model:'minimax/minimax-m3',messages:[]}); ledger.complete(row,{usage:null},'failed');
  assert.equal(ledger.exposureUsd,row.reservedUsd);assert.throws(()=>ledger.reserve({model:'minimax/minimax-m3',messages:[]}));
});
test('actual costs replace reservation, failed retry and unknown model are bounded',()=>{
  const ledger=budgetLedger({budgetUsd:1,maxRequests:1,prices});
  const row=ledger.reserve({model:'minimax/minimax-m3'});ledger.complete(row,{usage:{cost:0.002}},'succeeded');
  assert.equal(ledger.exposureUsd,0.002);assert.throws(()=>ledger.reserve({model:'minimax/minimax-m3'}));
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
