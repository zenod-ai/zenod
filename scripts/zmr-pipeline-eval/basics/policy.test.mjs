import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {validateSuite,plannedRows,selectRows,modelScenario,summarize,reviewTemplate,preservedEffects,preservedMarkedLines} from './policy.mjs';
const fixture=JSON.parse(await readFile(new URL('fixture.json',import.meta.url))),rubric=JSON.parse(await readFile(new URL('rubric.json',import.meta.url)));
const gates={rawCustody:true,inputPreserved:true,noDuplicateEffects:true,isolation:true,published:true,readOnlyPagesUnchanged:true};
const run=()=>({candidateSha:'a'.repeat(40),fixtureSha256:'b'.repeat(64),rubricSha256:'c'.repeat(64),mode:'ACTUAL_ENGINE_CHAT',sourceUnchanged:true,compiledUnchanged:true,budgetBlocks:[],rubricCheckCounts:Object.fromEntries(rubric.cases.map(c=>[c.id,c.checks.length])),outcomes:plannedRows(fixture).map(r=>({...r,status:'RECORDED',completedReplayStatus:'PASS',gates:{...gates}})),cost:{providerReportedCostUsd:0.5,unknownCostRequests:0}});
const reviewed=r=>{const v=reviewTemplate(r);for(const c of v.outcomes){c.reviewer='independent-reviewer';c.verdict='PASS';c.rationale='Verified actual answer and source read';for(const k of c.checks){k.status='PASS';k.evidence='turn0 + actual source/span';}}return v;};
test('fixed concrete12 cases and trial-major36 denominator',()=>{validateSuite(fixture,rubric);const rows=plannedRows(fixture);assert.equal(rows.length,36);assert.deepEqual(rows.slice(0,12).map(r=>r.id),fixture.cases.map(c=>c.id));assert.equal(rows[12].key,'B01:2');assert.equal(fixture.cases[5].memories[0].content.length,17066);});
test('B07 source chronology differs from processing order and distractors',()=>{const m=fixture.cases[6].memories;assert.ok(m[0].capturedAt>m[1].capturedAt);assert.equal(m[0].contentType,'voice_note');assert.equal(m[2].contentType,'audio');assert.ok(m[2].capturedAt>m[0].capturedAt);});
test('model projection discards evaluator fields and rubric',()=>{const c={...fixture.cases[0],expected:'SECRET_EXPECTATION',checks:['SECRET_EXPECTATION']};assert.ok(!JSON.stringify(modelScenario(c)).includes('SECRET_EXPECTATION'));assert.deepEqual(Object.keys(modelScenario(c)),['memories','turns']);});
test('unrun and budget stopped never shrink denominator',()=>{const r=run();r.outcomes[0].status='INCOMPLETE';r.outcomes[1].status='UNRUN';r.budgetBlocks=[{}];const s=summarize(r,reviewed(r));assert.equal(s.denominator,36);assert.equal(s.passed,34);assert.equal(s.verdict,'NOT_PASSED');assert.equal(s.rows[1].verdict,'UNMEASURED');});
test('process success and tool citations alone await semantics',()=>{const r=run();assert.equal(summarize(r).passed,0);assert.equal(summarize(r).rows[0].verdict,'REVIEW_REQUIRED');});
test('exact complete reviewed36 outcomes may pass',()=>{const r=run();assert.equal(summarize(r,reviewed(r)).verdict,'PASS');});
test('duplicate or mismatched outcome identity cannot manufacture36 passes',()=>{const r=run();r.outcomes[1]=r.outcomes[0];assert.throws(()=>summarize(r),/unique/);const q=run();q.outcomes[0].id='B02';assert.throws(()=>summarize(q),/unique/);});
test('required named custody gates fail closed',()=>{const r=run();r.outcomes[0].gates={foo:true};assert.equal(summarize(r,reviewed(r)).rows[0].verdict,'FAIL');});
test('review content/version and every check required',()=>{const r=run(),v=reviewed(r);v.fixtureSha256='wrong';assert.throws(()=>summarize(r,v),/version/);const w=reviewed(r);w.outcomes[0].checks=[];assert.throws(()=>summarize(r,w),/Incomplete/);const x=reviewed(r);r.outcomes[0].latencyMs=1;assert.throws(()=>summarize(r,x),/stale/);});
test('unknown provider cost prevents cost-per-pass value',()=>{const r=run();r.cost.unknownCostRequests=1;assert.equal(summarize(r,reviewed(r)).costPerPassedScenario,null);});
test('compiled drift cannot pass semantic-only approval',()=>{const r=run();r.compiledUnchanged=false;assert.equal(summarize(r,reviewed(r)).verdict,'NOT_PASSED');});
test('explicit batch selection retains globalplan and rejects duplicate selectors',()=>{const rows=plannedRows(fixture);assert.equal(selectRows(rows,'B08:1,B10:1').length,2);assert.equal(rows.length,36);assert.throws(()=>selectRows(rows,'B01:1,B01:1'));});
test('completed effects preserved without comparing incidental unassigned reviewer row',()=>{const o={ideaId:'a',topic:'first',status:'filed',appliedOperationIds:['op1'],filedPages:['Areas/A.md']};assert.ok(preservedEffects({outcomes:[o,{topic:'Unassigned',status:'uncertain'}]},{outcomes:[{...o,reason:'other'}]}));assert.ok(!preservedEffects({outcomes:[o]},{outcomes:[{...o,appliedOperationIds:[]}]}));});

test('actual completed marked claim/citation lines survive multi-destination logical aliases',()=>{
 const a='- claim [source](Log/a.md) <!-- zenod-op:one -->',b='- other [source](Log/a.md) <!-- zenod-op:two -->';
 const before={'A.md':a,'B.md':b},outcomes=[{status:'filed',filedPages:['A.md','B.md'],appliedOperationIds:['one','two','deduplicatedAlias']}];
 assert.ok(preservedMarkedLines(before,{'A.md':a+'\nnew claim','B.md':b},outcomes));
 assert.ok(!preservedMarkedLines(before,{'A.md':a+'\n'+a,'B.md':b},outcomes));
 assert.ok(!preservedMarkedLines(before,{'A.md':a.replace('claim','changed'),'B.md':b},outcomes));
});

test('pending B05 replay is unmeasured, not duplicate failure or semantic pass',()=>{const r=run();const b=r.outcomes.find(r=>r.id==='B05');b.completedReplayStatus='UNMEASURED';const report=summarize(r,reviewed(r));assert.equal(report.rows.find(x=>x.key===b.key).verdict,'INCOMPLETE');assert.equal(report.passed,35);});
