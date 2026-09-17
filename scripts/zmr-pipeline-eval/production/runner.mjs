import {createHash} from 'node:crypto';
import {executeScenario} from './scenario.mjs';
import {modelScenario,plannedRows,reviewTemplate} from '../basics/policy.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=code=>{throw new Error(code);};
export function validateManifest(m,fixtureBytes,rubricBytes){
 if(!/^[a-f0-9]{64}$/.test(m.tenant?.tokenHash??'')||!Number.isFinite(Date.parse(m.repo?.createdAt??'')))fail('invalid_owned_target');
 if(!m.models||!['model_classify','model_ask','model_classify_reasoning_effort'].every(k=>typeof m.models[k]==='string'&&m.models[k])||Object.keys(m.models).some(k=>!['model_classify','model_ask','model_classify_reasoning_effort','model_ask_reasoning_effort','model_classify_provider_order'].includes(k)||typeof m.models[k]!=='string'||!m.models[k].trim()))fail('invalid_models');
 if(m.version!==1||m.origin!=='https://cloud.zenod.dev'||!/^m2-[a-z0-9-]+$/.test(m.tenant?.id??'')||!Number.isSafeInteger(m.tenant.createdAt)||!/^m2-[a-z0-9-]+$/.test(m.repo?.name??'')||!Number.isSafeInteger(m.repo.id)||m.repo.id<=0||!/^[-\w]+$/.test(m.repo.owner??'')||m.repo.private!==true)fail('invalid_owned_target');
 if(!/^[a-f0-9]{40}$/.test(m.candidateSha??'')||!/^sha256:[a-f0-9]{64}$/.test(m.imageDigest??'')||m.fixtureSha256!==hash(fixtureBytes)||m.rubricSha256!==hash(rubricBytes)||!/^B(?:0[1-9]|1[0-2]):[123]$/.test(m.key??''))fail('invalid_version');
 if(!Number.isSafeInteger(m.exclusiveUntil)||!m.exclusiveWindow||m.noOtherTargetRequests!==true||!Number.isInteger(m.maxToolCalls)||m.maxToolCalls<5||m.maxToolCalls>40||!(m.maxExposureUsd>0)||!(m.reservedTurnExposureUsd>0)||m.reservedTurnExposureUsd>m.maxExposureUsd||!m.costBoundRationale)fail('invalid_bounds');
 return m;
}
export async function runProductionCase(m,fixtureBytes,rubricBytes,io,{dispatch=false,recovery=null,cleanupOnly=false}={}){
 validateManifest(m,fixtureBytes,rubricBytes);
 const fixture=JSON.parse(fixtureBytes),rubric=JSON.parse(rubricBytes),scenario=modelScenario(fixture.cases.find(c=>c.id===m.key.split(':')[0]));
 const binding=hash(JSON.stringify(m));
 if(recovery&&(recovery.binding!==binding||recovery.version!==1))fail('recovery_target_mismatch');
 const r=recovery?structuredClone(recovery):{version:1,binding,phase:'planned',calls:[],cost:{providerReportedCostUsd:null,unknownCostRequests:null,reservedExposureUsd:0,hardDollarCap:false},run:{mode:'PRODUCTION_MCP',candidateSha:m.candidateSha,fixtureSha256:m.fixtureSha256,rubricSha256:m.rubricSha256,outcomes:plannedRows(fixture),rubricCheckCounts:Object.fromEntries(rubric.cases.map(c=>[c.id,c.checks.length]))}};
 r.run.cost=r.cost;r.run.models=m.models;r.run.operatorHashes=io.codeHashes??null;
 const save=async phase=>{r.phase=phase;if(['complete','cleanup_pending'].includes(phase))r.run.review=reviewTemplate(r.run);await io.save(r);};
 const assertOwned=async()=>{const s=await io.inspect();if(s.tenantId!==m.tenant.id||s.tenantCreatedAt!==m.tenant.createdAt||s.repoId!==m.repo.id||s.repoFullName!==`${m.repo.owner}/${m.repo.name}`||s.repoPrivate!==true||!s.releaseVerified||!s.exclusive)fail('ownership_or_release_mismatch');return s;};
 const before=await assertOwned();
 if(!dispatch)return {status:'check_only',ready:before.drained&&before.seedMatches,manifestBinding:binding};
 if(!recovery&&!cleanupOnly&&(!before.drained||!before.seedMatches||Date.now()>=m.exclusiveUntil))fail('preflight_not_ready');
 const row=r.run.outcomes.find(x=>x.key===m.key),started=Date.now();
 try{
  if(!recovery&&!cleanupOnly){
   await save('test_planned');row.status='RUNNING';row.turns=[];
   const call=async(name,args)=>{if(Date.now()>=m.exclusiveUntil||r.calls.length>=m.maxToolCalls)fail('tool_limit');const c={name,args,startedAt:new Date().toISOString()};r.calls.push(c);await save('call_planned');c.result=await io.callTool(name,args);c.finishedAt=new Date().toISOString();await save('call_complete');if(c.result?.isError||!c.result?.structuredContent)fail('tool_failed');return c.result.structuredContent;};
   const wait=async id=>{for(let n=0;n<12;n++){if(n)await io.sleep(15000);const j=await call('get_task_result',{jobId:id});if(j.status==='done')return j;if(!['queued','running'].includes(j.status))fail('job_failed');}fail('job_unresolved');};
   const reserve=async()=>{if(r.cost.reservedExposureUsd+m.reservedTurnExposureUsd>m.maxExposureUsd)fail('exposure_limit');r.cost.reservedExposureUsd+=m.reservedTurnExposureUsd;await save('turn_reserved');};
   await executeScenario(m,scenario,{call,wait,reserve,snapshot:()=>io.snapshot()},row);
   row.gates=await io.verifyScenario(row);row.status='RECORDED';await save('recorded');
  }
 }catch{row.status='INCOMPLETE';r.error='test_incomplete';await save('test_incomplete');}
 finally{
  // Recovery is cleanup-only: never sends another chat or changes its idempotency key.
  try{await io.closeClient();if(!await io.drain())fail('drain_pending');await assertOwned();await save('cleanup_planned');await io.disableOwnedTenant();await io.archiveOwnedRepo();if(!await io.verifyCleanup())fail('cleanup_unverified');row.latencyMs=Date.now()-started;await save('complete');}
  catch{r.cleanupError='cleanup_pending';row.latencyMs=Date.now()-started;await save('cleanup_pending');}
 }
 return r;
}
