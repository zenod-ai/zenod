import {sha256} from '../policy.mjs';
export const SUITE_PROFILES=Object.freeze({
 'm2-basics-v1.1':{cases:12,outcomes:36},
 'm2-basics-v1.2':{cases:13,outcomes:39},
});
export const TOTAL_OUTCOMES=SUITE_PROFILES['m2-basics-v1.1'].outcomes;
export function validateSuite(fixture,rubric){
 const profile=SUITE_PROFILES[fixture.version];
 if(!profile||fixture.synthetic!==true||fixture.trials!==3||fixture.cases?.length!==profile.cases||rubric.plannedOutcomes!==profile.outcomes)throw new Error('Invalid fixed suite');
 const ids=Array.from({length:profile.cases},(_,i)=>'B'+String(i+1).padStart(2,'0'));
 if(JSON.stringify(fixture.cases.map(c=>c.id))!==JSON.stringify(ids)||JSON.stringify(rubric.cases.map(c=>c.id))!==JSON.stringify(ids))throw new Error('Missing or reordered scenario');
 if(fixture.cases.some(c=>!c.turns?.length||c.turns.some(t=>!['chat','interrupted_filing'].includes(t.kind))))throw new Error('Invalid scenario turns');
 for(const path of Object.keys(fixture.seedPages))if(!/^(Areas|Notes|Projects)\/[A-Za-z0-9 /&_-]+\.md$/.test(path))throw new Error('Unsafe fixture path');
 return fixture;
}
export function plannedRows(fixture){return Array.from({length:fixture.trials},(_,i)=>i+1).flatMap(trial=>fixture.cases.map(c=>({id:c.id,trial,key:`${c.id}:${trial}`,status:'UNRUN'})));}
export function selectRows(rows,selection){
 if(!selection)return rows;
 const keys=selection.split(',');if(new Set(keys).size!==keys.length||keys.some(k=>!rows.some(r=>r.key===k)))throw new Error('Invalid explicit batch selection');
 return rows.filter(r=>keys.includes(r.key));
}
export function modelScenario(c){
 // Rubric never enters this projection. Metadata/expectations cannot become a chat input.
 return {memories:c.memories.map(({id,content,contentType,capturedAt})=>({id,content,contentType,capturedAt})),turns:c.turns.map(t=>t.kind==='chat'?{kind:t.kind,message:t.message,thread:t.thread}:{kind:t.kind,memory:t.memory})};
}
export function summarize(run,review){
 const plannedKeys=Array.isArray(run.plannedKeys)&&run.plannedKeys.length>0?run.plannedKeys:undefined;
 const denominator=plannedKeys?.length??run.outcomes?.length;
 const expected=plannedKeys?new Set(plannedKeys):new Set(Array.from({length:Math.floor((denominator??0)/3)},(_,i)=>'B'+String(i+1).padStart(2,'0')).flatMap(id=>[1,2,3].map(trial=>`${id}:${trial}`)));
 if(!Number.isInteger(denominator)||denominator<3||denominator%3!==0||!Array.isArray(run.outcomes)||run.outcomes.length!==denominator||new Set(run.outcomes.map(r=>r.key)).size!==denominator||run.outcomes.some(r=>!expected.has(r.key)||r.key!==`${r.id}:${r.trial}`))throw new Error('Exact unique planned outcomes required');
 if(review&&(['candidateSha','fixtureSha256','rubricSha256'].some(k=>review[k]!==run[k])||!Array.isArray(review.outcomes)||new Set(review.outcomes.map(r=>r.key)).size!==review.outcomes.length||review.outcomes.some(r=>!expected.has(r.key))))throw new Error('Review version or identity mismatch');
 const requiredGates=['rawCustody','inputPreserved','noDuplicateEffects','isolation','published','readOnlyPagesUnchanged'];
 const rows=run.outcomes.map(row=>{
  const grade=review?.outcomes?.find(g=>g.key===row.key);
  const evidenceHash=sha256(JSON.stringify(row));
  let verdict=row.status==='UNRUN'?'UNMEASURED':row.status==='ERROR'?'FAIL':row.status==='INCOMPLETE'?'INCOMPLETE':'REVIEW_REQUIRED';
  const critical=requiredGates.every(k=>row.gates?.[k]===true)&&Object.values(row.gates??{}).every(v=>v===true);
  if(row.status==='RECORDED'&&!critical)verdict='FAIL';
  const missingReplay=row.id==='B05'&&row.completedReplayStatus!=='PASS';
  if(row.status==='RECORDED'&&critical&&missingReplay)verdict='INCOMPLETE';
  if(grade){
   if(grade.evidenceSha256!==evidenceHash||!grade.reviewer||!grade.rationale||!['PASS','FAIL'].includes(grade.verdict)||!Array.isArray(grade.checks)||grade.checks.length!==run.rubricCheckCounts[row.id]||grade.checks.some(c=>!['PASS','FAIL','UNMEASURED'].includes(c.status)||!c.evidence))throw new Error('Incomplete or stale semantic review');
   if(row.status==='RECORDED'&&critical&&!missingReplay)verdict=grade.verdict==='PASS'&&grade.checks.every(c=>c.status==='PASS')?'PASS':'FAIL';
  }
  return {key:row.key,verdict,evidenceSha256:evidenceHash,latencyMs:row.latencyMs??null};
 });
 const passed=rows.filter(r=>r.verdict==='PASS').length;
 return {denominator,passed,verdict:passed===denominator&&run.sourceUnchanged===true&&run.compiledUnchanged===true&&!run.budgetBlocks?.length&&run.mode==='ACTUAL_ENGINE_CHAT'?'PASS':'NOT_PASSED',rows,
  cost:run.cost??null,costPerPassedScenario:passed&&run.cost?.unknownCostRequests===0?run.cost.providerReportedCostUsd/passed:null,
  limitation:'Finite synthetic engine.chat evidence; not production MCP, WhatsApp delivery or universal reliability.'};
}
export function reviewTemplate(run){return {candidateSha:run.candidateSha,fixtureSha256:run.fixtureSha256,rubricSha256:run.rubricSha256,outcomes:run.outcomes.filter(r=>r.status!=='UNRUN').map(r=>({key:r.key,evidenceSha256:sha256(JSON.stringify(r)),reviewer:'',verdict:null,rationale:'',checks:Array.from({length:run.rubricCheckCounts[r.id]},()=>({status:'UNMEASURED',evidence:''}))}))};}
export function preservedEffects(before,after){
 return before.outcomes.filter(o=>o.ideaId&&o.status!=='pending').every(old=>{
  const current=after.outcomes.find(o=>o.ideaId===old.ideaId&&o.topic===old.topic);
  return current&&current.status===old.status&&['appliedOperationIds','filedPages','uncertainPages'].every(key=>(old[key]??[]).every(value=>(current[key]??[]).includes(value)));
 });
}
export function preservedMarkedLines(beforePages,afterPages,completedOutcomes){
 const paths=new Set(completedOutcomes.filter(o=>o.status==='filed').flatMap(o=>o.filedPages??[]));
 return [...paths].every(path=>{
  if(typeof beforePages[path]!=='string'||typeof afterPages[path]!=='string')return false;
  const before=beforePages[path].split('\n'),after=afterPages[path].split('\n');
  return [...new Set(before.filter(line=>line.includes('<!-- zenod-op:')))].every(line=>before.filter(v=>v===line).length===after.filter(v=>v===line).length);
 });
}

export async function lintSeedVault(lintVault,path){
 const report=await lintVault(path);
 if(!report.ok){const error=new Error('evaluation_invalid_seed');error.lintReport=report;throw error;}
 return report;
}
