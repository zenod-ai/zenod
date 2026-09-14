#!/usr/bin/env node
/** Real candidate media queue -> local Whisper -> archive -> real capture.
 * Local ASR uses existing weights; semantic calls use the shared bounded policy. */
import {parseArgs} from 'node:util';
import {readFile,writeFile,mkdir,mkdtemp,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {budgetLedger,prepareAsrEnvironment,requireCompletedEnrichment,terminalProviderGuard,evaluationFetch,evaluationCostSummary,evaluationCompletion,evaluationTerminalSummary,runEvaluationRecalls} from './policy.mjs';
import {classifyModelOption, organizerReasoningOption, evaluationModels} from './models.mjs';
const {values:a}=parseArgs({options:{'classify-model':classifyModelOption,'organizer-reasoning-effort':organizerReasoningOption,'organizer-provider-order':{type:'string'},runtime:{type:'string',default:'/app'},'candidate-sha':{type:'string'},audio:{type:'string'},'audio-sha256':{type:'string'},source:{type:'string'},'source-sha256':{type:'string'},'model-dir':{type:'string'},'model-sha256':{type:'string'},out:{type:'string'},prices:{type:'string'},questions:{type:'string'},'seed-pages':{type:'string'},'captured-at':{type:'string'},'source-repo':{type:'string'}}});
const models=evaluationModels(a);
for(const k of ['candidate-sha','audio','audio-sha256','source','source-sha256','model-dir','model-sha256','out','prices','questions','seed-pages','captured-at'])if(!a[k])throw new Error('Missing --'+k);
const evaluationKey=prepareAsrEnvironment(process.env);
const runtime=resolve(a['source-repo']??a.runtime);
const sourceGit=(...args)=>execFileSync('git',args,{cwd:runtime,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
if(!/^[a-f0-9]{40}$/.test(a['candidate-sha']))throw new Error('Exact candidate SHA required');
if(a['source-repo']){if(sourceGit('rev-parse','HEAD')!==a['candidate-sha']||sourceGit('status','--porcelain'))throw new Error('Native candidate must be exact and clean; operator must build before key injection');}
else if(process.env.GIT_SHA!==a['candidate-sha'])throw new Error('Exact candidate container GIT_SHA required');
if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(a['captured-at'])||!Number.isFinite(Date.parse(a['captured-at'])))throw new Error('Frozen canonical UTC captured-at required');
const hash=b=>createHash('sha256').update(b).digest('hex');
const audio=await readFile(a.audio),source=await readFile(a.source);
const modelHash=createHash('sha256');for await(const chunk of createReadStream(join(a['model-dir'],'ggml-large-v3-turbo.bin')))modelHash.update(chunk);
if(!a['source-repo']&&(await readFile(join(runtime,'.gitsha'),'utf8')).trim()!==a['candidate-sha'])throw new Error('Baked candidate source identity mismatch');
if(hash(audio)!==a['audio-sha256']||hash(source)!==a['source-sha256']||modelHash.digest('hex')!==a['model-sha256'])throw new Error('Frozen ASR input/model checksum mismatch');
// Local ASR never receives cloud credentials; model asset must already exist.
const pricesBytes=await readFile(a.prices),prices=JSON.parse(pricesBytes);
if(prices.syntheticTransportOnly||!prices.reviewedAt||!prices.source||!prices.models?.[models.classifyModel]||!prices.models?.[models.askModel])throw new Error('Reviewed actual prices required');
const seedBytes=await readFile(a['seed-pages']),seedPages=JSON.parse(seedBytes);
if(!seedPages||typeof seedPages!=='object'||Array.isArray(seedPages)||Object.entries(seedPages).some(([path,text])=>typeof text!=='string'||!path.endsWith('.md')||!['Projects','Areas','Notes'].includes(path.split('/')[0])||path.split('/').some(p=>!p||p==='..'||p==='.')||path.includes('\\')))throw new Error('Unsafe seed pages');
const questionsBytes=await readFile(a.questions),questions=JSON.parse(questionsBytes);
if(!Array.isArray(questions)||questions.length<3||questions.length>5||questions.some(q=>!q.id||typeof q.question!=='string'||q.question.length>1500))throw new Error('3–5 frozen recall questions required');
// Each of the two frozen speech fixtures gets at most $0.50 and40wire attempts.
const ledger=budgetLedger({budgetUsd:0.5,maxRequests:40,prices:prices.models});
process.env.ZENOD_WHISPER_MODEL_DIR=resolve(a['model-dir']);process.env.ZENOD_WHISPER_MODEL='large-v3-turbo';process.env.ZENOD_WHISPER_LANGUAGE='auto';
let deniedNetworkCalls=0;const actualFetch=globalThis.fetch;
const quota=terminalProviderGuard(),budgetBlocks=[];let currentStage='setup';
globalThis.fetch=evaluationFetch({ledger,quota,fetchImpl:request=>actualFetch(request),stage:()=>currentStage,
 onDenied:()=>deniedNetworkCalls++,onBudgetBlock:row=>budgetBlocks.push(row),
 onRequest:(row,body)=>save('wire-request-'+row.request+'.json',body),
 onResponse:(row,text)=>writeFile(join(out,'wire-response-'+row.request+'.txt'),text,{mode:0o600}),
});
const out=resolve(a.out);await mkdir(out,{mode:0o700});
const save=(name,value)=>writeFile(join(out,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
const runtimeHashes=async()=>{const result={};async function walk(path,relative){for(const e of await readdir(path,{withFileTypes:true})){const rel=relative+'/'+e.name;if(e.isSymbolicLink())throw new Error('Unexpected compiled module symlink');if(e.isDirectory())await walk(join(path,e.name),rel);else result[rel]=hash(await readFile(join(path,e.name)));}}
 for(const path of ['packages/core/dist','packages/server/dist','packages/mcp-chassis/dist'])await walk(join(runtime,path),path);
 if(a['source-repo'])for(const path of sourceGit('ls-files','packages/core/src','packages/server/src','packages/mcp-chassis/src','package-lock.json').split('\n').filter(Boolean))result[path]=hash(await readFile(join(runtime,path)));
 return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));};
const initialRuntimeHashes=await runtimeHashes();await save('runtime-hashes.json',initialRuntimeHashes);
const load=path=>import(pathToFileURL(join(runtime,path)).href);
const {createEngine,createBrainLlm,VaultRepo}=await load('packages/core/dist/index.js');
const {SqliteStateStore}=await load('packages/core/dist/state/sqlite.js');
const {TaskJobQueue}=await load('packages/server/dist/taskJobQueue.js');
const {TaskJobStore}=await load('packages/server/dist/taskJobStore.js');
const workspace=await mkdtemp(join(out,'isolated-')),bare=join(workspace,'origin.git'),seed=join(workspace,'seed');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
git(workspace,'init','--bare','--initial-branch=main',bare);git(workspace,'clone',bare,seed);git(seed,'config','user.name','ZMR synthetic ASR');git(seed,'config','user.email','zmr-asr@example.invalid');
await mkdir(join(seed,'.brain'));await writeFile(join(seed,'.brain/config.yml'),'schema_version: 1\ntags: []\nconfidence_threshold: 0.7\n');await writeFile(join(seed,'Index.md'),'# Synthetic ASR capture\n');for(const [path,text]of Object.entries(seedPages)){const parts=path.split('/');await mkdir(join(seed,...parts.slice(0,-1)),{recursive:true});await writeFile(join(seed,path),text);}
git(seed,'add','.');git(seed,'commit','-m','Isolated ASR capture');git(seed,'push','origin','main');
const repo=await VaultRepo.open({workdir:join(workspace,'work'),remoteUrl:bare});
const snapshots=async()=>{const result={};async function walk(path,relative=''){for(const e of await readdir(path,{withFileTypes:true})){if(e.name==='.git')continue;const rel=relative+e.name;if(e.isSymbolicLink())throw new Error('Unexpected symlink');if(e.isDirectory())await walk(join(path,e.name),rel+'/');else if(e.name.endsWith('.md'))result[rel]=await readFile(join(path,e.name),'utf8');}}await walk(repo.path);return result;};
await save('pages-before.json',await snapshots());
await writeFile(join(out,'frozen-seed-pages.json'),seedBytes,{mode:0o600});
await writeFile(join(out,'frozen-speech-source.txt'),source,{mode:0o600});await writeFile(join(out,'frozen-questions.json'),questionsBytes,{mode:0o600});await writeFile(join(out,'reviewed-prices.json'),pricesBytes,{mode:0o600});
const state=new SqliteStateStore(join(workspace,'memory.sqlite'));
const llmRaw=createBrainLlm({provider:'openrouter',apiKey:evaluationKey,...models});
const llm=new Proxy(llmRaw,{get(target,property){const method=Reflect.get(target,property);if(typeof method!=='function')return method;
 return async(...params)=>{quota.assertActive();const previous=currentStage;currentStage=String(property);
  try{return await method.apply(target,params);}finally{currentStage=previous;}};}});
const engine=createEngine({repo,llm,state,readSyncTtlMs:0});
const store=new TaskJobStore(join(workspace,'jobs.sqlite'),'synthetic-asr');
const settings={get:key=>({artifact_archive_provider:'local',artifact_archive_local_dir:join(workspace,'archive'),groq_api_key:'',openai_api_key:'',openrouter_api_key:''})[key]??null,whisperModel:()=> 'large-v3-turbo',openrouterTranscriptionModel:()=> 'openai/whisper-large-v3-turbo',longTranscriptionProvider:()=> 'local',useOpenAiForLongTranscription:()=>false};
const queue=new TaskJobQueue(store,async()=>engine,settings);
const report={classifier:models.classifyModel,askModel:models.askModel,organizerReasoningEffort:models.organizerReasoningEffort??null,organizerProviderOrder:models.organizerProviderOrder??null,mode:a['source-repo']?'ACTUAL_NATIVE_CANDIDATE_ASR_MEDIA_QUEUE':'ACTUAL_IMAGE_CANDIDATE_ASR_MEDIA_QUEUE',candidateSha:a['candidate-sha'],capturedAt:a['captured-at'],audioSha256:hash(audio),sourceSha256:hash(source),modelSha256:a['model-sha256'],workspace,startedAt:new Date().toISOString(),semanticEvaluation:'NOT_EVALUATED',recalls:[],budgetBlocks,budgetUsd:0.5,seedSha256:hash(seedBytes),pricesSha256:hash(pricesBytes),questionsSha256:hash(questionsBytes),driverSha256:hash(await readFile(fileURLToPath(import.meta.url))),phoneIngress:false};
report.harnessHashes=Object.fromEntries(await Promise.all(['asr-ingress.mjs','policy.mjs','models.mjs'].map(async name=>[name,hash(await readFile(new URL(name,import.meta.url)))])));
try {
 const job=queue.enqueue('media_ingest',{mediaType:'audio',contentType:'voice_note',bytesRef:'data:audio/wav;base64,'+audio.toString('base64'),filename:'synthetic-asr.wav',sourceHint:'ZMR synthetic local ASR evaluator',senderTimestamp:a['captured-at']},'synthetic-asr:'+hash(audio));
 const deadline=Date.now()+30*60*1000;let terminal;
 while(Date.now()<deadline){terminal=store.get(job.id);if(['done','error','cancelled','interrupted'].includes(terminal?.status))break;await new Promise(r=>setTimeout(r,250));}
 report.mediaJob=terminal;if(terminal?.status!=='done')throw new Error('ASR media capture did not complete');
 const result=terminal.result,raw=new URL(result.rawArtifact.handle),transcriptUrl=new URL(result.extraction.transcriptHandle);
 for(const url of [raw,transcriptUrl])if(url.protocol!=='file:'||!fileURLToPath(url).startsWith(workspace+'/'))throw new Error('Archive outside isolated workspace');
 const transcript=await readFile(transcriptUrl,'utf8');await writeFile(join(out,'actual-asr-transcript.txt'),transcript,{mode:0o600});
 const evidence=await engine.getEntry(result.digest.evidenceRef);
 report.invariants={archivedAudioMatches:hash(await readFile(raw))===hash(audio),transcriptNonempty:transcript.trim().length>0,rawEvidenceContainsActualTranscript:evidence.content.includes(transcript.trimEnd()),evidenceTimestamp:evidence.capturedAt===a['captured-at'],evidenceContentType:evidence.contentType==='voice_note',evidenceSource:evidence.source==='mcp',evidenceSourceId:evidence.sourceId==='synthetic-asr:'+hash(audio),actualLocalProvider:/whisper/i.test(result.extraction.provider??'')&&!/provided|evaluation/i.test(result.extraction.provider??'')};
 report.actualTranscriptSha256=hash(Buffer.from(transcript));report.enrichmentJobId=result.digest.enrichmentJobId;
 if(!Object.values(report.invariants).every(Boolean))throw new Error('ASR custody invariant failed');
 const enrichDeadline=Date.now()+30*60*1000;let enrichment;
 while(Date.now()<enrichDeadline){enrichment=store.get(report.enrichmentJobId);if(['done','error','cancelled','interrupted'].includes(enrichment?.status))break;await new Promise(r=>setTimeout(r,250));}
 report.enrichmentJob=enrichment;requireCompletedEnrichment(enrichment);report.invariants.enrichmentCompleted=true;
 report.invariants.enrichmentIdentity=enrichment.input.capturedAt===a['captured-at']&&enrichment.input.contentType==='voice_note'&&enrichment.input.source==='mcp'&&enrichment.input.sourceId===evidence.sourceId&&enrichment.input.evidenceRef===evidence.evidenceRef;
 if(!report.invariants.enrichmentIdentity)throw new Error('Enrichment provenance mismatch');
 await save('pages-after.json',await snapshots());report.publishedRevision=await repo.currentPublishedRevision();
 quota.assertActive();
 const beforeReplay=await repo.currentRevision();report.replay=await engine.enrichEvidence(enrichment.input);report.afterReplayRevision=await repo.currentRevision();
 await save('pages-after-replay.json',await snapshots());
 report.invariants.completedReplayNoRevisionChange=enrichment.result?.filing!=='filed'||beforeReplay.id===report.afterReplayRevision.id;
 await runEvaluationRecalls({questions,quota,recalls:report.recalls,runTrial:async q=>{
  const fresh=new SqliteStateStore(':memory:');const start=performance.now();
  try{return {answer:await createEngine({repo,llm,state:fresh,readSyncTtlMs:0}).ask(q.question),latencyMs:performance.now()-start};}finally{fresh.close();}
 }});
 await save('pages-after-recall.json',await snapshots());
 report.invariants.runtimeUnchanged=JSON.stringify(await runtimeHashes())===JSON.stringify(initialRuntimeHashes)&&(!a['source-repo']||(sourceGit('rev-parse','HEAD')===a['candidate-sha']&&!sourceGit('status','--porcelain')));
 report.invariants.recallsSucceeded=report.recalls.length===questions.length*3&&report.recalls.every(r=>r.answer);
 const completion=evaluationCompletion({quota,recalls:report.recalls,plannedRecalls:questions.length*3,budgetBlocks,
  invariantFailed:Object.entries(report.invariants).some(([key,passed])=>key!=='recallsSucceeded'&&!passed)});
 report.status=completion.status;report.recallCoverage=completion.recallCoverage;
 report.semanticEvaluation=report.status==='AWAITING_INDEPENDENT_SEMANTIC_REVIEW'?'INDEPENDENT_REVIEW_REQUIRED':report.status;
 if(report.status!=='AWAITING_INDEPENDENT_SEMANTIC_REVIEW')process.exitCode=1;
}catch(error){report.status=quota.terminal?quota.terminal.status:budgetBlocks.length?'INCOMPLETE_BUDGET':'FAILED';report.errorClass=error.name;process.exitCode=1;}
finally{
 await queue.close();if(report.enrichmentJobId)report.enrichmentJob=store.get(report.enrichmentJobId);store.close();state.close();
 globalThis.fetch=actualFetch;report.requests=ledger.rows;Object.assign(report,evaluationCostSummary(ledger));
 report.recallCoverage=evaluationCompletion({quota,recalls:report.recalls,plannedRecalls:questions.length*3}).recallCoverage;
 if(quota.terminal){report.status=quota.terminal.status;Object.assign(report,evaluationTerminalSummary(quota));process.exitCode=1;
  await save(quota.terminal.status==='INCOMPLETE_PROVIDER_QUOTA'?'pages-after-quota.json':'pages-after-deadline.json',await snapshots());}
 if(report.status!=='AWAITING_INDEPENDENT_SEMANTIC_REVIEW')report.semanticEvaluation=report.status;
 report.deniedNetworkCalls=deniedNetworkCalls;report.finishedAt=new Date().toISOString();await save('asr-run.json',report);
 console.log(JSON.stringify({status:report.status,out,semanticEvaluation:report.semanticEvaluation,...evaluationCostSummary(ledger),
  ...evaluationTerminalSummary(quota)}));
}

// Final private receipt is already durable; do not wait for a noncooperative socket.
if(quota.terminal?.status==='INCOMPLETE_PROVIDER_DEADLINE')process.exit(1);
