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
import {budgetLedger,parseWireUsage} from './policy.mjs';
const {values:a}=parseArgs({options:{runtime:{type:'string',default:'/app'},'candidate-sha':{type:'string'},audio:{type:'string'},'audio-sha256':{type:'string'},source:{type:'string'},'source-sha256':{type:'string'},'model-dir':{type:'string'},'model-sha256':{type:'string'},out:{type:'string'},prices:{type:'string'},questions:{type:'string'},'seed-pages':{type:'string'}}});
for(const k of ['candidate-sha','audio','audio-sha256','source','source-sha256','model-dir','model-sha256','out','prices','questions','seed-pages'])if(!a[k])throw new Error('Missing --'+k);
if(!/^[a-f0-9]{40}$/.test(a['candidate-sha'])||process.env.GIT_SHA!==a['candidate-sha'])throw new Error('Exact candidate container GIT_SHA required');
const hash=b=>createHash('sha256').update(b).digest('hex');
const audio=await readFile(a.audio),source=await readFile(a.source);
const modelHash=createHash('sha256');for await(const chunk of createReadStream(join(a['model-dir'],'ggml-large-v3-turbo.bin')))modelHash.update(chunk);
if((await readFile(join(resolve(a.runtime),'.gitsha'),'utf8')).trim()!==a['candidate-sha'])throw new Error('Baked candidate source identity mismatch');
if(hash(audio)!==a['audio-sha256']||hash(source)!==a['source-sha256']||modelHash.digest('hex')!==a['model-sha256'])throw new Error('Frozen ASR input/model checksum mismatch');
// Local ASR never receives cloud credentials; model asset must already exist.
if(!process.env.ZMR_EVAL_OPENROUTER_KEY)throw new Error('Protected evaluation key required');
const pricesBytes=await readFile(a.prices),prices=JSON.parse(pricesBytes);
if(prices.syntheticTransportOnly||!prices.reviewedAt||!prices.source)throw new Error('Reviewed actual prices required');
const seedBytes=await readFile(a['seed-pages']),seedPages=JSON.parse(seedBytes);
if(!seedPages||typeof seedPages!=='object'||Array.isArray(seedPages)||Object.entries(seedPages).some(([path,text])=>typeof text!=='string'||!path.endsWith('.md')||!['Projects','Areas','Notes'].includes(path.split('/')[0])||path.split('/').some(p=>!p||p==='..'||p==='.')||path.includes('\\')))throw new Error('Unsafe seed pages');
const questionsBytes=await readFile(a.questions),questions=JSON.parse(questionsBytes);
if(!Array.isArray(questions)||questions.length<3||questions.length>5||questions.some(q=>!q.id||typeof q.question!=='string'||q.question.length>1500))throw new Error('3–5 frozen recall questions required');
// Each of the two frozen speech fixtures gets at most $0.50 and40wire attempts.
const ledger=budgetLedger({budgetUsd:0.5,maxRequests:40,prices:prices.models});
for(const key of ['GROQ_API_KEY','OPENAI_API_KEY','OPENROUTER_API_KEY'])delete process.env[key];
process.env.ZENOD_WHISPER_MODEL_DIR=resolve(a['model-dir']);process.env.ZENOD_WHISPER_MODEL='large-v3-turbo';process.env.ZENOD_WHISPER_LANGUAGE='auto';
let deniedNetworkCalls=0;const actualFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const request=new Request(input,init),url=new URL(request.url);
 if(url.origin!=='https://openrouter.ai'||url.pathname!=='/api/v1/chat/completions'||request.method!=='POST'){deniedNetworkCalls++;throw new Error('asr_evaluation_network_denied');}
 const body=await request.clone().json(),row=ledger.reserve(body),start=performance.now();
 await save('wire-request-'+row.request+'.json',body);
 try{const response=await actualFetch(new Request(request,{signal:AbortSignal.any([request.signal,AbortSignal.timeout(120000)])}));const text=await response.clone().text();await writeFile(join(out,'wire-response-'+row.request+'.txt'),text,{mode:0o600});ledger.complete(row,parseWireUsage(text),response.ok?'succeeded':'failed');return response;}
 catch(error){ledger.complete(row,null,'failed');throw error;}finally{row.latencyMs=performance.now()-start;}
};
const out=resolve(a.out);await mkdir(out,{mode:0o700});
const save=(name,value)=>writeFile(join(out,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
const load=path=>import(pathToFileURL(join(resolve(a.runtime),path)).href);
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
const llm=createBrainLlm({provider:'openrouter',apiKey:process.env.ZMR_EVAL_OPENROUTER_KEY,classifyModel:'minimax/minimax-m3',askModel:'x-ai/grok-4.3'});
const engine=createEngine({repo,llm,state,readSyncTtlMs:0});
const store=new TaskJobStore(join(workspace,'jobs.sqlite'),'synthetic-asr');
const settings={get:key=>({artifact_archive_provider:'local',artifact_archive_local_dir:join(workspace,'archive'),groq_api_key:'',openai_api_key:'',openrouter_api_key:''})[key]??null,whisperModel:()=> 'large-v3-turbo',openrouterTranscriptionModel:()=> 'openai/whisper-large-v3-turbo',longTranscriptionProvider:()=> 'local',useOpenAiForLongTranscription:()=>false};
const queue=new TaskJobQueue(store,async()=>engine,settings);
const report={mode:'ACTUAL_LOCAL_ASR_MEDIA_QUEUE_CAPTURE_ENRICH_RECALL',candidateSha:a['candidate-sha'],audioSha256:hash(audio),sourceSha256:hash(source),modelSha256:a['model-sha256'],workspace,startedAt:new Date().toISOString(),semanticEvaluation:'INDEPENDENT_REVIEW_REQUIRED',recalls:[],budgetUsd:0.5,seedSha256:hash(seedBytes),pricesSha256:hash(pricesBytes),questionsSha256:hash(questionsBytes),driverSha256:hash(await readFile(fileURLToPath(import.meta.url))),phoneIngress:false};
try {
 const job=queue.enqueue('media_ingest',{mediaType:'audio',contentType:'voice_note',bytesRef:'data:audio/wav;base64,'+audio.toString('base64'),filename:'synthetic-asr.wav',sourceHint:'ZMR synthetic local ASR evaluator'},'synthetic-asr:'+hash(audio));
 const deadline=Date.now()+30*60*1000;let terminal;
 while(Date.now()<deadline){terminal=store.get(job.id);if(['done','error','cancelled','interrupted'].includes(terminal?.status))break;await new Promise(r=>setTimeout(r,250));}
 report.mediaJob=terminal;if(terminal?.status!=='done')throw new Error('ASR media capture did not complete');
 const result=terminal.result,raw=new URL(result.rawArtifact.handle),transcriptUrl=new URL(result.extraction.transcriptHandle);
 for(const url of [raw,transcriptUrl])if(url.protocol!=='file:'||!fileURLToPath(url).startsWith(workspace+'/'))throw new Error('Archive outside isolated workspace');
 const transcript=await readFile(transcriptUrl,'utf8');await writeFile(join(out,'actual-asr-transcript.txt'),transcript,{mode:0o600});
 const evidence=await engine.getEntry(result.digest.evidenceRef);
 report.invariants={archivedAudioMatches:hash(await readFile(raw))===hash(audio),transcriptNonempty:transcript.trim().length>0,rawEvidenceContainsActualTranscript:evidence.content.includes(transcript.trimEnd()),actualLocalProvider:/whisper/i.test(result.extraction.provider??'')&&!/provided|evaluation/i.test(result.extraction.provider??'')};
 report.actualTranscriptSha256=hash(Buffer.from(transcript));report.enrichmentJobId=result.digest.enrichmentJobId;
 if(!Object.values(report.invariants).every(Boolean))throw new Error('ASR custody invariant failed');
 const enrichDeadline=Date.now()+30*60*1000;let enrichment;
 while(Date.now()<enrichDeadline){enrichment=store.get(report.enrichmentJobId);if(['done','error','cancelled','interrupted'].includes(enrichment?.status))break;await new Promise(r=>setTimeout(r,250));}
 report.enrichmentJob=enrichment;report.invariants.enrichmentCompleted=enrichment?.status==='done';
 await save('pages-after.json',await snapshots());report.publishedRevision=await repo.currentPublishedRevision();
 const beforeReplay=await repo.currentRevision();report.replay=await engine.enrichEvidence(enrichment.input);report.afterReplayRevision=await repo.currentRevision();
 await save('pages-after-replay.json',await snapshots());
 report.invariants.completedReplayNoRevisionChange=enrichment.result?.filing!=='filed'||beforeReplay.id===report.afterReplayRevision.id;
 for(const q of questions)for(let trial=1;trial<=3;trial++){const fresh=new SqliteStateStore(':memory:');try{const answer=await createEngine({repo,llm,state:fresh,readSyncTtlMs:0}).ask(q.question);report.recalls.push({id:q.id,question:q.question,trial,answer});}catch(error){report.recalls.push({id:q.id,trial,error:String(error.message)});}finally{fresh.close();}}
 await save('pages-after-recall.json',await snapshots());
 report.invariants.recallsSucceeded=report.recalls.every(r=>!r.error);
 report.status=Object.values(report.invariants).every(Boolean)?'INDEPENDENT_SEMANTIC_REVIEW_REQUIRED':'INVARIANT_FAILURE';
 if(report.status==='INVARIANT_FAILURE')process.exitCode=1;
}catch(error){report.status='FAILED';report.error=String(error.message);process.exitCode=1;}
finally{await queue.close();if(report.enrichmentJobId)report.enrichmentJob=store.get(report.enrichmentJobId);store.close();state.close();report.requests=ledger.rows;report.exposureUsd=ledger.exposureUsd;report.deniedNetworkCalls=deniedNetworkCalls;report.finishedAt=new Date().toISOString();await save('asr-run.json',report);console.log(JSON.stringify({status:report.status,out,semanticEvaluation:report.semanticEvaluation}));}
