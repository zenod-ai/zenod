#!/usr/bin/env node
/** Actual candidate engine/adapter/queue evaluation. Default is offline planning. */
import {parseArgs} from 'node:util';
import {readFile, writeFile, mkdir, mkdtemp, readdir} from 'node:fs/promises';
import {resolve, join, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {sha256, HELDOUT_SHA256, validateFixture, sourceInput, budgetLedger, coverageRows, terminalProviderGuard, evaluationFetch, evaluationCostSummary, evaluationCompletion,evaluationTerminalSummary, runEvaluationRecalls} from './policy.mjs';
import {classifyModelOption, organizerReasoningOption, evaluationModels} from './models.mjs';
const {values: args} = parseArgs({options:{
  live:{type:'boolean',default:false}, 'offline-smoke':{type:'boolean',default:false}, fixture:{type:'string',default:'/tmp/zmr15-heldout/heldout.json'},
  'candidate-repo':{type:'string'}, 'candidate-sha':{type:'string'}, out:{type:'string'}, prices:{type:'string'},
  'classify-model':classifyModelOption,'organizer-reasoning-effort':organizerReasoningOption,'organizer-provider-order':{type:'string'},
  questions:{type:'string'}, audio:{type:'string'}, 'ask-model':{type:'string',default:'x-ai/grok-4.3'},
  'budget-usd':{type:'string',default:'1'}, 'max-requests':{type:'string',default:'60'},
}});
const models=evaluationModels(args);
const bytes = await readFile(resolve(args.fixture));
const fixture = validateFixture(bytes);
const mode = args.audio ? 'actual-local-media-archive-with-provided-transcript' : 'actual-capture-then-durable-enrichment';
if (args.live && args['offline-smoke']) throw new Error('Choose live or offline smoke, never both');
if (!args.live && !args['offline-smoke']) {
  console.log(JSON.stringify({mode:'OFFLINE_PLAN_ONLY', fixtureId:fixture.id, fixtureSha256:HELDOUT_SHA256,
    sourceChars:fixture.transcript.length, evaluatorIdeas:fixture.ground_truth.length,
    plannedSurface:mode, classifier:models.classifyModel, askModel:models.askModel, organizerReasoningEffort:models.organizerReasoningEffort??null,organizerProviderOrder:models.organizerProviderOrder??null,
    externalCalls:0, needs:['accepted exact candidate SHA', 'reviewed price manifest', 'private recall question file',
      'existing key supplied securely via ZMR_EVAL_OPENROUTER_KEY at execution', 'independent semantic review after run'],
    limitations:['not phone ingress', 'provided transcript does not evaluate ASR', 'span coverage is not idea correctness']},null,2));
  process.exit(0);
}
for (const name of ['candidate-repo','candidate-sha','out','prices','questions']) if (!args[name]) throw new Error('Live mode requires --'+name);
if (!/^[a-f0-9]{40}$/.test(args['candidate-sha'])) throw new Error('Full candidate SHA required');
if (args.live && !process.env.ZMR_EVAL_OPENROUTER_KEY) throw new Error('Evaluation key must be securely supplied at execution');
const candidate = resolve(args['candidate-repo']);
const git = (...argv) => execFileSync('git',argv,{cwd:candidate,encoding:'utf8'}).trim();
if (git('rev-parse','HEAD') !== args['candidate-sha'] || git('status','--porcelain')) throw new Error('Candidate must be exact and clean');
const output = resolve(args.out);
await mkdir(output,{mode:0o700}); // Exclusive new directory; never overwrite an earlier run.
const save = (name, value) => writeFile(join(output,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
const pricingBytes = await readFile(resolve(args.prices));
const pricing = JSON.parse(pricingBytes);
if(args.live && pricing.syntheticTransportOnly) throw new Error('Synthetic prices cannot authorize live calls');
if (!pricing.reviewedAt || !pricing.source || !pricing.models?.[models.classifyModel] || !pricing.models?.[models.askModel]) throw new Error('Reviewed prices for both actual configured models required');
const questionsBytes = await readFile(resolve(args.questions));
const questions = JSON.parse(questionsBytes);
if (!Array.isArray(questions) || questions.length < 3 || questions.length > 10 || questions.some(q=>!q.id || typeof q.question!=='string' || q.question.length>1500)) throw new Error('Provide 3–10 frozen recall questions');
const telemetry = {mode, candidateSha:args['candidate-sha'], fixtureSha256:sha256(bytes), pricingSha256:sha256(pricingBytes),
  questionsSha256:sha256(questionsBytes), node:process.version, platform:process.platform, startedAt:new Date().toISOString(),
  classifier:models.classifyModel, askModel:models.askModel, organizerReasoningEffort:models.organizerReasoningEffort??null,organizerProviderOrder:models.organizerProviderOrder??null, modelUsage:[], engineTokenEstimates:[], operations:[], requests:[], recalls:[], budgetBlocks:[],
  acceptance:'NOT_EVALUATED', syntheticTransport:args['offline-smoke'], externalCalls:0, billingWarning:'Budget uses reviewed rate reservations; unexpected provider charges can exceed a reservation. Missing usage is never zero cost.'};
await save('run.json',telemetry);
await writeFile(join(output,'frozen-fixture.json'),bytes,{mode:0o600});
await writeFile(join(output,'frozen-questions.json'),questionsBytes,{mode:0o600});
await writeFile(join(output,'reviewed-prices.json'),pricingBytes,{mode:0o600});
const sourcePaths=git('ls-files','packages/core/src','packages/server/src').split('\n').filter(Boolean);
const sourceHashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,sha256(await readFile(join(candidate,path)))])));
telemetry.sourceHashes=await sourceHashes();
telemetry.harnessHashes=Object.fromEntries(await Promise.all(['run.mjs','policy.mjs','models.mjs'].map(async name=>[name,sha256(await readFile(new URL(name,import.meta.url)))])));
// Build from pinned tracked code so stale dist output cannot silently stand in for the candidate.
const buildEnv={...process.env};delete buildEnv.ZMR_EVAL_OPENROUTER_KEY;
const buildLog=execFileSync('npm',['run','build'],{cwd:candidate,env:buildEnv,encoding:'utf8',maxBuffer:20*1024*1024});
await writeFile(join(output,'build.log'),buildLog,{mode:0o600});
const ledger=budgetLedger({budgetUsd:Number(args['budget-usd']),maxRequests:Number(args['max-requests']),prices:pricing.models});
const originalFetch=globalThis.fetch;
let currentStage='setup';
const quota=terminalProviderGuard();
globalThis.fetch=evaluationFetch({ledger,quota,stage:()=>currentStage,
  onBudgetBlock:row=>telemetry.budgetBlocks.push(row),
  onRequest:(row,body)=>save('wire-request-'+row.request+'.json',body),
  onResponse:(row,text)=>writeFile(join(output,'wire-response-'+row.request+'.txt'),text,{mode:0o600}),
  onFinish:async()=>{telemetry.requests=ledger.rows;Object.assign(telemetry,evaluationCostSummary(ledger));Object.assign(telemetry,evaluationTerminalSummary(quota));await save('run.json',telemetry);},
  fetchImpl:async request=>{
    const body=await request.clone().json(),row=ledger.rows.at(-1);let response;
    if(args['offline-smoke']){
      const classify=JSON.stringify(body.messages).includes('Classify an incoming memory');
      const content=classify?JSON.stringify({passageReviews:[],topics:[{topic:'Offline smoke',facts:[],evidenceQuotes:['Offline plumbing fixture'],evidenceAssignments:[],disposition:'evidence_only',confidence:1,pages:[],summary:'Offline smoke',question:null}],disposition:'evidence_only',confidence:1,summary:'Offline plumbing smoke only',tags:[],pages:[],question:null}):'Offline plumbing smoke only; no semantic evaluation.';
      const base={id:'offline-'+row.request,object:'chat.completion',created:1,model:body.model};
      const usage={prompt_tokens:1,completion_tokens:1,total_tokens:2,cost:0};
      response=body.stream?new Response('data: '+JSON.stringify({...base,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}],usage})+'\n\ndata: [DONE]\n',{headers:{'content-type':'text/event-stream'}}):new Response(JSON.stringify({...base,choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage}),{headers:{'content-type':'application/json'}});
    }else{telemetry.externalCalls++;response=await originalFetch(request);}
    return response;
  },
});
const load = path => import(pathToFileURL(join(candidate,path)).href);
let queue, store, state, snapshots;
try {
  const {createEngine,createBrainLlm,VaultRepo}=await load('packages/core/dist/index.js');
  const {SqliteStateStore}=await load('packages/core/dist/state/sqlite.js');
  const {TaskJobQueue}=await load('packages/server/dist/taskJobQueue.js');
  const {TaskJobStore}=await load('packages/server/dist/taskJobStore.js');
  const workspace=await mkdtemp(join(tmpdir(),'zenod-zmr15-'));
  telemetry.isolatedWorkspace=workspace;
  const bare=join(workspace,'origin.git'), seed=join(workspace,'seed');
  const localGit=(cwd,...argv)=>execFileSync('git',argv,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  localGit(workspace,'init','--bare','--initial-branch=main',bare);
  localGit(workspace,'clone',bare,seed);
  localGit(seed,'config','user.name','ZMR isolated evaluator');localGit(seed,'config','user.email','zmr-eval@example.invalid');
  for(const [path,text] of Object.entries(fixture.seed_pages)){await mkdir(dirname(join(seed,path)),{recursive:true});await writeFile(join(seed,path),text);}
  await mkdir(join(seed,'.brain'),{recursive:true});
  await writeFile(join(seed,'.brain/config.yml'),'schema_version: 1\ntags: []\nconfidence_threshold: 0.7\n');
  await writeFile(join(seed,'Index.md'),'# Evaluation memory\n\n'+Object.keys(fixture.seed_pages).map(path=>'[['+path.slice(0,-3)+']]').join('\n')+'\n');
  localGit(seed,'add','.');localGit(seed,'commit','-m','Frozen isolated evaluation source');localGit(seed,'push','origin','main');
  const repo=await VaultRepo.open({workdir:join(workspace,'work'),remoteUrl:bare});
  snapshots=async()=>{
    const result={};
    async function walk(path,relative=''){for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(entry.name==='.git')continue;const rel=relative+entry.name;
      if(entry.isSymbolicLink())throw new Error('Unexpected evaluation symlink');
      if(entry.isDirectory())await walk(join(path,entry.name),rel+'/');else if(entry.name.endsWith('.md'))result[rel]=await readFile(join(path,entry.name),'utf8');}}
    await walk(repo.path);return result;
  };
  const llmRaw=createBrainLlm({provider:'openrouter',apiKey:args['offline-smoke']?'offline-unused-key':process.env.ZMR_EVAL_OPENROUTER_KEY,...models,
    onUsage:row=>telemetry.modelUsage.push({stage:currentStage,...row})});
  const llm=new Proxy(llmRaw,{get(target,property){const method=Reflect.get(target,property);if(typeof method!=='function')return method;
    return async(...params)=>{quota.assertActive();const previous=currentStage;currentStage=String(property);const started=performance.now();
      const row={method:String(property),input:JSON.parse(JSON.stringify(params[0]??null))};telemetry.operations.push(row);
      try{const result=await method.apply(target,params);row.result=JSON.parse(JSON.stringify(result??null));return result;}catch(error){row.errorClass=error.name;throw error;}
      finally{row.latencyMs=performance.now()-started;currentStage=previous;}};}});
  state=new SqliteStateStore(join(workspace,'memory.sqlite'));
  const create=localState=>createEngine({repo,llm,state:localState,readSyncTtlMs:0,onTokenCost:row=>telemetry.engineTokenEstimates.push(row)});
  const engine=create(state);
  store=new TaskJobStore(join(workspace,'jobs.sqlite'),'zmr-evaluator');
  const settings={get:key=>({artifact_archive_provider:'local',artifact_archive_local_dir:join(workspace,'archive')})[key]??null};
  queue=new TaskJobQueue(store,async()=>engine,settings);
  const before=await snapshots();await save('pages-before.json',before);
  const input=sourceInput(fixture);
  const waitJob=async id=>{const deadline=Date.now()+30*60*1000;while(Date.now()<deadline){const job=store.get(id);if(['done','error','cancelled','interrupted'].includes(job?.status))return job;await new Promise(r=>setTimeout(r,250));}throw new Error('evaluation_job_timeout');};
  let captured,enrichmentInput,media;
  if(args.audio){
    const audio=await readFile(resolve(args.audio));telemetry.audioSha256=sha256(audio);
    media=queue.enqueue('media_ingest',{mediaType:'audio',contentType:'voice_note',bytesRef:'data:audio/wav;base64,'+audio.toString('base64'),filename:'synthetic-evaluation.wav',sourceHint:'ZMR local evaluator',senderTimestamp:input.capturedAt,
      providedTranscript:fixture.transcript,transcriptionProvider:'evaluation-provided-transcript',transcriptionDisposition:'provided'},input.sourceId);
    const terminal=await waitJob(media.id);telemetry.mediaReceipt=terminal;
    if(terminal.status!=='done')throw new Error('evaluation_media_capture_failed');
    const id=terminal.result.digest.enrichmentJobId;if(!id)throw new Error('Missing asynchronous enrichment identity');
    enrichmentInput=store.get(id).input;captured=terminal.result.digest;
    telemetry.enrichmentJob=await waitJob(id);
  }else{
    const countBefore=ledger.rows.length;
    captured=await engine.captureEvidence(input);
    telemetry.captureUsedNoModel=ledger.rows.length===countBefore;
    enrichmentInput={...input,evidenceRef:captured.evidenceRef};
    const job=queue.enqueue('enrich_memory',enrichmentInput,'enrich:'+input.sourceId);
    telemetry.enrichmentJob=await waitJob(job.id);
  }
  telemetry.capture=captured;
  const after=await snapshots();await save('pages-after.json',after);
  const evidence=await engine.getEntry(captured.evidenceRef);await save('raw-evidence.json',evidence);
  const sourceOffset=enrichmentInput.semanticRange?.start??0;
  telemetry.invariants={enrichmentJobCompleted:telemetry.enrichmentJob.status==='done',rawEvidenceMatches:evidence.content===enrichmentInput.content.trimEnd(),
    forbiddenPagesUnchanged:(fixture.forbidden_updates??[]).every(path=>before[path]===after[path]),
    unrelatedTextPreserved:(fixture.preserve_exact??[]).every(text=>Object.entries(before).filter(([,page])=>page.includes(text)).every(([path])=>after[path]?.includes(text)))};
  if(args.audio){
    const receipt=telemetry.mediaReceipt.result;
    const rawUrl=new URL(receipt.rawArtifact.handle), transcriptUrl=new URL(receipt.extraction.transcriptHandle);
    if([rawUrl,transcriptUrl].some(url=>url.protocol!=='file:' || !fileURLToPath(url).startsWith(workspace+'/')))throw new Error('evaluation_archive_outside_isolation');
    telemetry.invariants.archivedAudioMatches=sha256(await readFile(rawUrl))===telemetry.audioSha256&&receipt.rawArtifact.sha256===telemetry.audioSha256;
    telemetry.invariants.archivedTranscriptMatches=(await readFile(transcriptUrl,'utf8'))===fixture.transcript;
  }
  telemetry.assignmentCoverage=coverageRows(fixture,telemetry.enrichmentJob.result,sourceOffset);
  // Exercise job coalescing and direct enrichment replay separately.
  const repeatedCapture=await engine.captureEvidence({...enrichmentInput,sourceId:input.sourceId});
  telemetry.invariants.sameEvidenceIdentity=repeatedCapture.evidenceRef===captured.evidenceRef;
  quota.assertActive();
  const replayStart=ledger.rows.length;
  telemetry.directReplay=await engine.enrichEvidence(enrichmentInput);
  const afterReplay=await snapshots();await save('pages-after-replay.json',afterReplay);
  telemetry.replayPagesChanged=JSON.stringify(after)!==JSON.stringify(afterReplay);
  telemetry.replayRequiresPartialProgressReview=telemetry.enrichmentJob.result?.filing!=='filed';
  telemetry.invariants.completedReplayHasNoPageChanges=telemetry.replayRequiresPartialProgressReview||!telemetry.replayPagesChanged;
  telemetry.invariants.replayEvidenceUnchanged=Object.keys(after).filter(path=>path.startsWith('Log/')).every(path=>after[path]===afterReplay[path]);
  telemetry.invariants.replayForbiddenPagesUnchanged=(fixture.forbidden_updates??[]).every(path=>before[path]===afterReplay[path]);
  telemetry.replayNetworkRequests=ledger.rows.length-replayStart;
  if(!args.audio){const prior=telemetry.enrichmentJob;const same=queue.enqueue('enrich_memory',enrichmentInput,'enrich:'+input.sourceId);telemetry.invariants.sameJobIdentity=same.id===prior.id;}
  // Fresh engine and SQLite for each question/trial: no previous answer/conversation context.
  await runEvaluationRecalls({questions,quota,recalls:telemetry.recalls,runTrial:async question=>{
    const fresh=new SqliteStateStore(':memory:');const start=performance.now();
    try{return {answer:await create(fresh).ask(question.question),latencyMs:performance.now()-start};}finally{fresh.close();}
  }});
  telemetry.invariants.recallDoesNotMutate=JSON.stringify(await snapshots())===JSON.stringify(afterReplay);
  telemetry.invariants.candidateSourceUnchanged=JSON.stringify(await sourceHashes())===JSON.stringify(telemetry.sourceHashes)&&git('rev-parse','HEAD')===args['candidate-sha'];
  const completion=evaluationCompletion({quota,recalls:telemetry.recalls,plannedRecalls:questions.length*3,
    budgetBlocks:telemetry.budgetBlocks,invariantFailed:!Object.values(telemetry.invariants).every(Boolean),offline:args['offline-smoke']});
  telemetry.acceptance=completion.status;telemetry.recallCoverage=completion.recallCoverage;
  if(telemetry.acceptance!=='AWAITING_INDEPENDENT_SEMANTIC_REVIEW'&&telemetry.acceptance!=='OFFLINE_PLUMBING_ONLY')process.exitCode=1;
  await save('semantic-review.json',{status:telemetry.acceptance.startsWith('INCOMPLETE_')?telemetry.acceptance:'REVIEW_REQUIRED',assignmentRows:telemetry.assignmentCoverage,
    checks:['Review each new/changed claim for entailment and qualification','Review false LINK_SOURCE/lost distinctions','Verify correction history and unresolved conflicts','Review every mandatory recall answer in all three fresh sessions','Compute idea/candidate/operation recall from model traces, not source overlap alone'],
    falseWrites:null,unsupportedClaims:null,correctOperations:null,ideaRecall:null,candidateRecall:null});
}catch(error){telemetry.acceptance=quota.terminal?quota.terminal.status:telemetry.budgetBlocks.length?'INCOMPLETE_BUDGET':'RUN_FAILED';telemetry.errorClass=error.name;telemetry.failureStage=currentStage;
  if(String(error.message).startsWith('evaluation_'))telemetry.errorCode=error.message;process.exitCode=1;
}finally{
  // close waits for the real durable job; leave isolated workspace for review/recovery.
  await queue?.close();store?.close();state?.close();globalThis.fetch=originalFetch;
  telemetry.finishedAt=new Date().toISOString();telemetry.requests=ledger.rows;Object.assign(telemetry,evaluationCostSummary(ledger));
  telemetry.recallCoverage=evaluationCompletion({quota,recalls:telemetry.recalls,plannedRecalls:questions.length*3}).recallCoverage;
  if(quota.terminal){if(snapshots)await save(quota.terminal.status==='INCOMPLETE_PROVIDER_QUOTA'?'pages-after-quota.json':'pages-after-deadline.json',await snapshots());telemetry.acceptance=quota.terminal.status;Object.assign(telemetry,evaluationTerminalSummary(quota));process.exitCode=1;
    await save('semantic-review.json',{status:telemetry.acceptance,recallCoverage:telemetry.recallCoverage,...evaluationTerminalSummary(quota),
      assignmentRows:telemetry.assignmentCoverage??[],note:'Review observed partial evidence only; unstarted trials are unmeasured.'});}

  const latencies=ledger.rows.map(row=>row.latencyMs).filter(Number.isFinite).sort((a,b)=>a-b);
  telemetry.requestLatency={samples:latencies.length,p50:latencies[Math.max(0,Math.ceil(latencies.length*.5)-1)]??null,p95:latencies[Math.max(0,Math.ceil(latencies.length*.95)-1)]??null};
  await save('run.json',telemetry);
  console.log(JSON.stringify({acceptance:telemetry.acceptance,output,requests:ledger.rows.length,...evaluationCostSummary(ledger),...evaluationTerminalSummary(quota),semanticQuality:'NOT_AUTOMATICALLY_SCORED',surface:mode},null,2));
}

// Final private receipt is already durable; do not wait for a noncooperative socket.
if(quota.terminal?.status==='INCOMPLETE_PROVIDER_DEADLINE')process.exit(1);
