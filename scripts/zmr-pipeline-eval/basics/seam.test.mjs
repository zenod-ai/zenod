import test from 'node:test';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {join} from 'node:path';
// Optional integration against the exact separately built candidate; never calls models.
const candidate=process.env.M2_CANDIDATE_REPO;
test('real engine.chat + synthetic seam retain same-thread turns and isolate another thread',{skip:!candidate},async()=>{
 const load=p=>import(pathToFileURL(join(candidate,p)).href);
 const {createEngine}=await load('packages/core/dist/index.js');const {SqliteStateStore}=await load('packages/core/dist/state/sqlite.js');const {runSyntheticChat}=await load('packages/server/dist/testHarness.js');
 const state=new SqliteStateStore(':memory:'),calls=[];
 const engine=createEngine({repo:null,state,llm:{answer:async input=>{calls.push(input);return {text:'Offline seam response',readPaths:[]};}}});
 const invoke=(message,key)=>runSyntheticChat({request:{message,surface:'mcp',conversationKey:key,testRunId:'offline-m2'},defaultSurface:'mcp',getEngine:async()=>engine,recordAudit:a=>state.recordChatTestRun(a)});
 try{
  assert.equal((await invoke('First topic is ceramics.','main')).status,'ok');await invoke('Other thread is astronomy.','other');await invoke('What do you think about it?','main');
  assert.deepEqual(calls[0].conversation,[]);assert.deepEqual(calls[1].conversation,[]);
  assert.equal(calls[2].conversation[0].text,'First topic is ceramics.');assert.equal(calls[2].conversation.length,2);assert.ok(!JSON.stringify(calls[2].conversation).includes('astronomy'));
  const fresh=new SqliteStateStore(':memory:');try{assert.deepEqual(await fresh.recentWindow('mcp:main'),[]);}finally{fresh.close();}
 }finally{state.close();}
});
test('actual engine background capture finishes through onFilingComplete before harness drain',{skip:!candidate},async()=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {execFileSync}=await import('node:child_process');const {backgroundFilingTracker}=await import('./background.mjs');
 const load=p=>import(pathToFileURL(join(candidate,p)).href);const {createEngine,VaultRepo}=await load('packages/core/dist/index.js');const {SqliteStateStore}=await load('packages/core/dist/state/sqlite.js');
 const root=await mkdtemp(join(tmpdir(),'m2-offline-drain-')),git=(cwd,...args)=>execFileSync('git',args,{cwd,stdio:'pipe',encoding:'utf8'}).trim(),bare=join(root,'origin.git'),seed=join(root,'seed');
 let state;
 try{
  git(root,'init','--bare','--initial-branch=main',bare);git(root,'clone',bare,seed);git(seed,'config','user.name','Offline test');git(seed,'config','user.email','test@example.invalid');
  await mkdir(join(seed,'.brain'));await writeFile(join(seed,'.brain/config.yml'),'schema_version: 1\ntags: []\nconfidence_threshold: 0.7\n');await writeFile(join(seed,'Index.md'),'# Synthetic offline test\n');git(seed,'add','.');git(seed,'commit','-m','seed');git(seed,'push','origin','main');
  const repo=await VaultRepo.open({workdir:join(root,'work'),remoteUrl:bare});state=new SqliteStateStore(':memory:');const tracker=backgroundFilingTracker();let release,entered;const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
  const llm={answer:async(_input,_read,task)=>{await tracker.wrapCapture(task.captureNote.bind(task))('The synthetic room is blue.');return {text:'Queued for filing.',readPaths:[]};},classify:async input=>{entered();await gate;return {disposition:'evidence_only',confidence:1,summary:'Synthetic room report',tags:[],pages:[],topics:[],passageReviews:input.sourcePassages.map(p=>({passageId:p.id,status:'evidence_only'}))};}};
  const engine=createEngine({repo,state,llm,readSyncTtlMs:0,onFilingComplete:result=>tracker.complete(result)});
  await engine.chat('File this synthetic room report.','mcp',{conversationKey:'drain-proof'});await started;
  assert.equal(tracker.pending,1);let drained=false;const completion=tracker.drain(2000).then(()=>{drained=true;});await Promise.resolve();assert.equal(drained,false);
  release();await completion;assert.equal(tracker.pending,0);assert.equal(tracker.receipts.length,1);assert.ok(tracker.receipts[0].evidenceRef.startsWith('Log/'));assert.equal(git(repo.path,'rev-parse','HEAD'),git(root,'--git-dir',bare,'rev-parse','main'));
 }finally{state?.close();await rm(root,{recursive:true,force:true});}
});
test('candidate lint rejects original malformed seed before calls and accepts v1.1',{skip:!candidate},async()=>{
 const {readFile,mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {dirname}=await import('node:path');const {lintSeedVault}=await import('./policy.mjs');
 const {lintVault}=await import(pathToFileURL(join(candidate,'packages/core/dist/vault/lint.js')).href),fixture=JSON.parse(await readFile(new URL('fixture.json',import.meta.url))),root=await mkdtemp(join(tmpdir(),'m2-seed-lint-'));
 try{
  await mkdir(join(root,'.brain'));await writeFile(join(root,'.brain/config.yml'),'schema_version: 1\ntags: []\nconfidence_threshold: 0.7\n');await writeFile(join(root,'Index.md'),'# M2\n');
  for(const [path,text] of Object.entries(fixture.seedPages)){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),text.replace(/^(type|created|updated):.*\n/gm,'').replace('\n[[Index]]\n',''));}
  let calls=0;await assert.rejects(async()=>{await lintSeedVault(lintVault,root);calls++;},error=>error.message==='evaluation_invalid_seed'&&error.lintReport.errors.some(e=>e.rule==='frontmatter/field')&&error.lintReport.errors.some(e=>e.rule==='links/orphan'));assert.equal(calls,0);
  for(const [path,text] of Object.entries(fixture.seedPages))await writeFile(join(root,path),text);
  const valid=await lintSeedVault(lintVault,root);assert.equal(valid.ok,true);assert.equal(valid.checkedFiles,4);
 }finally{await rm(root,{recursive:true,force:true});}
});
