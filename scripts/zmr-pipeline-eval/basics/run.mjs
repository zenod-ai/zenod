#!/usr/bin/env node
/** Synthetic actual-engine baseline. No live mode without explicit candidate/config/key/caps. */
import {parseArgs} from 'node:util';
import {readFile,writeFile,mkdir,mkdtemp,readdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {sha256,budgetLedger,terminalProviderGuard,evaluationFetch,evaluationCostSummary,prepareAsrEnvironment} from '../policy.mjs';
import {evaluationModels} from '../models.mjs';
import {validateSuite,plannedRows,selectRows,modelScenario,reviewTemplate,summarize,preservedEffects,preservedMarkedLines} from './policy.mjs';
const {values:a}=parseArgs({options:{live:{type:'boolean',default:false},'preflight':{type:'boolean',default:false},'candidate-repo':{type:'string'},'candidate-sha':{type:'string'},'deployed-sha':{type:'string'},out:{type:'string'},prices:{type:'string'},'classify-model':{type:'string'},'ask-model':{type:'string'},'organizer-reasoning-effort':{type:'string'},'organizer-provider-order':{type:'string'},'budget-usd':{type:'string',default:'1'},'max-requests':{type:'string',default:'80'},select:{type:'string'}}});
const fixtureBytes=await readFile(new URL('fixture.json',import.meta.url)),rubricBytes=await readFile(new URL('rubric.json',import.meta.url));
const fixture=validateSuite(JSON.parse(fixtureBytes),JSON.parse(rubricBytes)),rubric=JSON.parse(rubricBytes);
const rows=plannedRows(fixture),selected=selectRows(rows,a.select);
if(!a.live&&!a.preflight){console.log(JSON.stringify({mode:'OFFLINE_PLAN',fixtureSha256:sha256(fixtureBytes),rubricSha256:sha256(rubricBytes),denominator:36,selected:selected.map(r=>r.key),externalCalls:0,cap:{usd:Number(a['budget-usd']),requests:Number(a['max-requests'])},warning:'36 multi-turn outcomes may exceed one $1/80-request run. Unstarted outcomes remain unmeasured. No automatic budget reset or resume.',needs:['exact clean built candidate','explicit current model identifiers and effort','reviewed prices','protected key for live only','independent semantic review']},null,2));process.exit(0);}
if(a.live&&a.preflight)throw new Error('Choose live or preflight');
// Remove secrets before any child process; real live mode rejects fake/test hooks.
const key=a.live?prepareAsrEnvironment(process.env):undefined;
for(const k of ['ZMR_EVAL_OPENROUTER_KEY','OPENAI_API_KEY','OPENROUTER_API_KEY','GROQ_API_KEY'])delete process.env[k];
for(const name of ['candidate-repo','candidate-sha','deployed-sha','out','prices','classify-model','ask-model'])if(!a[name])throw new Error('Required --'+name);
if(![a['candidate-sha'],a['deployed-sha']].every(s=>/^[a-f0-9]{40}$/.test(s)))throw new Error('Full source and observed deployment SHA required');
const models=evaluationModels(a),candidate=resolve(a['candidate-repo']);
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
if(git(candidate,'rev-parse','HEAD')!==a['candidate-sha']||git(candidate,'status','--porcelain'))throw new Error('Candidate must be exact clean checkout');
const output=resolve(a.out);await mkdir(output,{mode:0o700});
const save=(name,value)=>writeFile(join(output,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
const pricingBytes=await readFile(resolve(a.prices)),pricing=JSON.parse(pricingBytes);
if(!pricing.reviewedAt||!pricing.source||!pricing.models?.[models.classifyModel]||!pricing.models?.[models.askModel]||(a.live&&pricing.syntheticTransportOnly))throw new Error('Reviewed actual-model prices required');
const ledger=budgetLedger({budgetUsd:Number(a['budget-usd']),maxRequests:Number(a['max-requests']),prices:pricing.models}),quota=terminalProviderGuard();
const sourcePaths=git(candidate,'ls-files','packages/core/src','packages/server/src','packages/mcp-chassis/src').split('\n').filter(Boolean);
const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async p=>[p,sha256(await readFile(join(candidate,p)))])));
const run={suite:fixture.version,candidateSha:a['candidate-sha'],observedDeployedSha:a['deployed-sha'],deploymentIdentity:'operator-supplied; this isolated runner does not verify live health',mode:a.live?'ACTUAL_ENGINE_CHAT':'OFFLINE_PREFLIGHT',fixtureSha256:sha256(fixtureBytes),rubricSha256:sha256(rubricBytes),pricingSha256:sha256(pricingBytes),models,startedAt:new Date().toISOString(),limits:{budgetUsd:Number(a['budget-usd']),maxRequests:Number(a['max-requests']),requestDeadlineMs:120000,plannedOutcomes:36},selected:selected.map(r=>r.key),outcomes:rows,rubricCheckCounts:Object.fromEntries(rubric.cases.map(c=>[c.id,c.checks.length])),requests:ledger.rows,budgetBlocks:[],externalCalls:0,usage:[],sourceHashes:await hashes(),harnessHashes:{},compiledHashes:{},status:'RUNNING'};
for(const rel of ['run.mjs','policy.mjs','report.mjs','fixture.json','rubric.json','../policy.mjs','../models.mjs'])run.harnessHashes[rel]=sha256(await readFile(new URL(rel,import.meta.url)));
await save('run.json',run);await writeFile(join(output,'fixture.json'),fixtureBytes,{mode:0o600});await writeFile(join(output,'rubric.json'),rubricBytes,{mode:0o600});await writeFile(join(output,'prices.json'),pricingBytes,{mode:0o600});
const hashTree=async path=>{const result={};async function walk(root,rel=''){for(const e of(await readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(e.isSymbolicLink())throw new Error('Symlink in evaluated tree');const p=join(root,e.name),r=rel+e.name;if(e.isDirectory())await walk(p,r+'/');else result[r]=sha256(await readFile(p));}}await walk(path);return result;};
// Builds before network activation, with evaluation credentials absent from environment.
await writeFile(join(output,'build.log'),execFileSync('npm',['run','build'],{cwd:candidate,encoding:'utf8',maxBuffer:30*1024*1024}),{mode:0o600});
for(const pkg of ['core','server','mcp-chassis'])run.compiledHashes[pkg]=await hashTree(join(candidate,'packages',pkg,'dist'));
const load=p=>import(pathToFileURL(join(candidate,p)).href);
const {createEngine,createBrainLlm,VaultRepo}=await load('packages/core/dist/index.js');
const {SqliteStateStore}=await load('packages/core/dist/state/sqlite.js');
const {TaskJobStore}=await load('packages/server/dist/taskJobStore.js');
const {TaskJobQueue}=await load('packages/server/dist/taskJobQueue.js');
const {runSyntheticChat}=await load('packages/server/dist/testHarness.js');
const originalFetch=globalThis.fetch;let stage='setup';
const flush=async()=>{run.cost={...evaluationCostSummary(ledger),unknownCostRequests:ledger.rows.filter(r=>r.actualCostUsd===null).length};await save('run.json',run);};
globalThis.fetch=a.preflight?async()=>{throw new Error('Preflight forbids network');}:evaluationFetch({ledger,quota,stage:()=>stage,onBudgetBlock:row=>run.budgetBlocks.push(row),onRequest:(row,body)=>save(`wire-request-${row.request}.json`,body),onResponse:(row,body)=>writeFile(join(output,`wire-response-${row.request}.txt`),body,{mode:0o600}),onFinish:flush,fetchImpl:async request=>{run.externalCalls++;return originalFetch(request);}});
const snapshot=async root=>{const result={};async function walk(dir,rel=''){for(const e of await readdir(dir,{withFileTypes:true})){if(e.name==='.git')continue;if(e.isSymbolicLink())throw new Error('Unexpected vault symlink');const p=join(dir,e.name),r=rel+e.name;if(e.isDirectory())await walk(p,r+'/');else if(e.name.endsWith('.md'))result[r]=await readFile(p,'utf8');}}await walk(root);return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
try{
 for(const row of selected){
  if(quota.terminal||run.budgetBlocks.length)break;
  const scenario=modelScenario(fixture.cases.find(c=>c.id===row.id)),start=performance.now(),firstRequest=ledger.rows.length;
  row.status='RUNNING';row.turns=[];row.operations=[];row.reads=[];row.captures=[];row.gates={isolation:false,rawCustody:false,inputPreserved:false,noDuplicateEffects:false,published:false};
  let queue,store,state,repo;const workspace=await mkdtemp(join(tmpdir(),'zenod-m2-'));row.workspace=workspace;
  const caseDir=join(output,row.key.replace(':','-'));await mkdir(caseDir,{mode:0o700});
  const caseSave=(name,value)=>writeFile(join(caseDir,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
  try{
   const bare=join(workspace,'origin.git'),seed=join(workspace,'seed');
   git(workspace,'init','--bare','--initial-branch=main',bare);git(workspace,'clone',bare,seed);git(seed,'config','user.name','M2 synthetic evaluator');git(seed,'config','user.email','m2@example.invalid');
   for(const [path,text]of Object.entries(fixture.seedPages)){await mkdir(dirname(join(seed,path)),{recursive:true});await writeFile(join(seed,path),text);}
   await mkdir(join(seed,'.brain'));await writeFile(join(seed,'.brain/config.yml'),'schema_version: 1\ntags: []\nconfidence_threshold: 0.7\n');await writeFile(join(seed,'Index.md'),'# Synthetic M2 memory\n\n'+Object.keys(fixture.seedPages).map(p=>'[['+p.slice(0,-3)+']]').join('\n'));
   git(seed,'add','.');git(seed,'commit','-m','M2 frozen synthetic baseline');git(seed,'push','origin','main');
   repo=await VaultRepo.open({workdir:join(workspace,'work'),remoteUrl:bare});
   row.gates.isolation=git(repo.path,'remote','get-url','origin')===bare;
   const before=await snapshot(repo.path);await caseSave('pages-before.json',before);
   if(a.preflight){row.status='PREFLIGHT_ONLY';row.gates={isolation:row.gates.isolation};continue;}
   let reconcileCalls=0,inject=false,injected=false;
   const raw=createBrainLlm({provider:'openrouter',apiKey:key,...models,onUsage:usage=>run.usage.push({case:row.key,stage,...usage})});
   const llm=new Proxy(raw,{get(target,prop){const method=Reflect.get(target,prop);if(typeof method!=='function')return method;return async(...params)=>{
    quota.assertActive();if(run.budgetBlocks.length)throw new Error('evaluation_budget_latched');
    stage=`${row.key}:${String(prop)}`;
    if(prop==='reconcile'&&inject&&++reconcileCalls===2){injected=true;row.injectedFailure={boundary:'before-second-reconcile',realModelOutputFabricated:false};throw new Error('evaluation_injected_page_interruption');}
    const op={method:String(prop),input:JSON.parse(JSON.stringify(params[0]??null))};row.operations.push(op);
    if(prop==='answer'){const prior=params[0].onReadAction;params[0]={...params[0],onReadAction:(tool,input,result)=>{row.reads.push({turn:row.turns.length,tool,input,result});prior?.(tool,input,result);}};}
    try{const result=await method.apply(target,params);op.result=JSON.parse(JSON.stringify(result??null));return result;}catch(error){op.errorClass=error.name;throw error;}
   };}});
   state=new SqliteStateStore(join(workspace,'state.sqlite'));
   const create=()=>createEngine({repo,llm,state,readSyncTtlMs:0});let engine=create();
   store=new TaskJobStore(join(workspace,'jobs.sqlite'),'m2-synthetic');queue=new TaskJobQueue(store,async()=>engine);
   const inputs=[];
   const capture=async memory=>{const input={content:memory.content,source:'mcp',contentType:memory.contentType,capturedAt:memory.capturedAt,sourceId:`m2:${row.key}:${memory.id}`,verbatim:true};const captured=await engine.captureEvidence(input);const enrichment={...input,evidenceRef:captured.evidenceRef};inputs.push({memory,input,enrichment,captured});row.captures.push({input,captured});return enrichment;};
   const waitJob=async id=>{const deadline=Date.now()+15*60*1000;while(Date.now()<deadline){const job=store.get(id);if(['done','error','interrupted','cancelled'].includes(job?.status))return job;await new Promise(r=>setTimeout(r,25));}throw new Error('evaluation_job_timeout');};
   for(const memory of scenario.memories){stage=`${row.key}:seed`;const input=await capture(memory),job=queue.enqueue('enrich_memory',input,'enrich:'+input.sourceId);const terminal=await waitJob(job.id);row.captures.at(-1).job=terminal;if(terminal.status!=='done')throw new Error('evaluation_seed_filing_failed');}
   const ready=await snapshot(repo.path);await caseSave('pages-after-setup.json',ready);
   for(const turn of scenario.turns){
    quota.assertActive();if(run.budgetBlocks.length)throw new Error('evaluation_budget_latched');
    if(turn.kind==='chat'){
     stage=`${row.key}:chat:${row.turns.length}`;const t0=performance.now();
     const result=await runSyntheticChat({request:{message:turn.message,surface:'mcp',conversationKey:`m2:${row.key}:${turn.thread}`,testRunId:row.key},defaultSurface:'mcp',getEngine:async()=>new Proxy(engine,{get(target,prop){if(prop!=='chat')return Reflect.get(target,prop);return async(...args)=>{const result=await target.chat(...args);row.chatCoverage??=[];row.chatCoverage.push(result.coverage??null);return result;};}}),recordAudit:a=>state.recordChatTestRun(a)});
     row.turns.push({message:turn.message,thread:turn.thread,result,latencyMs:performance.now()-t0});
     if(result.status==='error')throw new Error('evaluation_chat_error');
    }else{
     const input=await capture(turn.memory);inject=true;
     // Fixture starts with the automatic retry budget already consumed. This lets
     // the durable intermediate receipt survive before explicitly reopening engine.
     const job=store.enqueue('enrich_memory',input,'enrich:'+input.sourceId);
     const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(join(workspace,'jobs.sqlite'));try{db.prepare('UPDATE task_jobs SET attempts=1 WHERE id=?').run(job.id);}finally{db.close();}
     queue.resume();const terminal=await waitJob(job.id);row.interruptedJob=terminal;await queue.close();inject=false;
     const receiptPath='Inbox/filing-'+input.evidenceRef.slice(4).replace('.md#^','-')+'.md';
     const getReceipt=async()=>{const bytes=await readFile(join(repo.path,receiptPath),'utf8'),match=bytes.match(/\n```json\n([\s\S]*)\n```\n?$/);if(!match)throw new Error('Missing receipt');return JSON.parse(match[1]);};
     const partial=await getReceipt();const partialPages=await snapshot(repo.path);const originalJob=store.get(job.id);row.interruptedInputSha256=sha256(JSON.stringify(originalJob.input));await caseSave('receipt-interrupted.json',partial);await caseSave('pages-interrupted.json',partialPages);
     row.interruptionObserved=injected&&partial.outcomes.some(o=>o.status==='filed')&&partial.outcomes.some(o=>o.status==='pending');
     engine=create();row.retry=await engine.enrichEvidence(input);const after=await getReceipt();await caseSave('receipt-after-retry.json',after);
     row.completedSiblingsPreserved=preservedEffects(partial,after);
     const retryPages=await snapshot(repo.path);row.completedTextAndCitationsPreserved=preservedMarkedLines(partialPages,retryPages,partial.outcomes);
     row.durableInputPreserved=equal(store.get(job.id).input,originalJob.input)&&store.get(job.id).attempts===originalJob.attempts&&after.inputFingerprint===partial.inputFingerprint;
     row.duplicateCapture=await engine.captureEvidence(input);row.duplicateJob=store.enqueue('enrich_memory',input,'enrich:'+input.sourceId);
     const snap=await snapshot(repo.path),calls=ledger.rows.length;
     if(!after.outcomes.some(o=>o.status==='pending')){row.replay=await engine.enrichEvidence(input);row.completedReplayUnchanged=equal(snap,await snapshot(repo.path))&&calls===ledger.rows.length;}else row.completedReplayUnchanged=null;
     row.completedReplayStatus=row.completedReplayUnchanged===null?'UNMEASURED':row.completedReplayUnchanged?'PASS':'FAIL';
     row.gates.noDuplicateEffects=row.interruptionObserved&&row.completedSiblingsPreserved&&row.completedTextAndCitationsPreserved&&row.completedReplayUnchanged!==false&&row.duplicateCapture.evidenceRef===input.evidenceRef&&row.duplicateJob.id===job.id&&equal(row.duplicateJob.input,input);
    }
    await flush();
   }
   const after=await snapshot(repo.path);await caseSave('pages-after.json',after);
   row.gates.rawCustody=true;row.gates.inputPreserved=row.id==='B05'?row.durableInputPreserved===true:true;
   for(const item of inputs){const entry=await engine.getEntry(item.captured.evidenceRef);if(entry.content!==item.input.content.trimEnd())row.gates.rawCustody=false;if(!equal(item.enrichment,{...item.input,evidenceRef:item.captured.evidenceRef}))row.gates.inputPreserved=false;}
   if(row.id!=='B05')row.gates.noDuplicateEffects=new Set(inputs.map(i=>i.captured.evidenceRef)).size===inputs.length;
   // Conversational write cases must actually produce immutable evidence, not merely acknowledge.
   if(['B01','B04','B10'].includes(row.id)){
    const message=scenario.turns[0].message,content=message.slice(message.indexOf(': ')+2),entries=[];
    for(const [path,bytes]of Object.entries(after).filter(([path])=>path.startsWith('Log/')))for(const match of bytes.matchAll(/\^(e-[a-f0-9]{6})\b/g))entries.push(await engine.getEntry(`${path}#^${match[1]}`));
    const matching=entries.filter(e=>e.content===message||e.content===content);
    row.gates.rawCustody=matching.length>=1;row.gates.noDuplicateEffects=matching.length===1;row.rawEntries=entries;
   }
   row.gates.published=git(repo.path,'rev-parse','HEAD')===git(workspace,'--git-dir',bare,'rev-parse','main')&&!git(repo.path,'status','--porcelain');
   row.readOnlyPagesUnchanged=['B01','B04','B05','B10'].includes(row.id)||equal(ready,after);row.gates.readOnlyPagesUnchanged=row.readOnlyPagesUnchanged;
   row.status='RECORDED';
  }catch(error){row.status=quota.terminal||run.budgetBlocks.length?'INCOMPLETE':'ERROR';row.errorClass=error.name;row.errorCode=/^evaluation_[a-z_]+$/.test(error.message)?error.message:'operation_failed';}
  finally{await queue?.close();store?.close();state?.close();row.latencyMs=performance.now()-start;const requests=ledger.rows.slice(firstRequest);row.requestNumbers=requests.map(r=>r.request);row.cost={providerReportedCostUsd:requests.reduce((n,r)=>n+(r.actualCostUsd??0),0),unknownCostRequests:requests.filter(r=>r.actualCostUsd===null).length,retainedUnknownCostReservationsUsd:requests.filter(r=>r.actualCostUsd===null).reduce((n,r)=>n+r.reservedUsd,0)};row.tokens=requests.map(r=>({request:r.request,usage:r.wire?.usage??null}));await caseSave('outcome.json',row);await flush();}
 }
 run.sourceUnchanged=equal(run.sourceHashes,await hashes())&&git(candidate,'rev-parse','HEAD')===run.candidateSha&&!git(candidate,'status','--porcelain');
 run.compiledUnchanged=true;for(const pkg of ['core','server','mcp-chassis'])if(!equal(run.compiledHashes[pkg],await hashTree(join(candidate,'packages',pkg,'dist'))))run.compiledUnchanged=false;
 run.status=a.preflight?'PREFLIGHT_ONLY':quota.terminal?.status??(run.budgetBlocks.length?'INCOMPLETE_BUDGET':'AWAITING_SEMANTIC_REVIEW');
}catch(error){run.status='RUN_FAILED';run.errorClass=error.name;}
finally{globalThis.fetch=originalFetch;run.finishedAt=new Date().toISOString();run.terminal=quota.terminal;await flush();await save('review-template.json',reviewTemplate(run));await save('report.json',summarize(run));console.log(JSON.stringify({status:run.status,output,denominator:36,recorded:run.outcomes.filter(r=>r.status==='RECORDED').length,...run.cost}));}
if(quota.terminal?.status==='INCOMPLETE_PROVIDER_DEADLINE')process.exit(1);
