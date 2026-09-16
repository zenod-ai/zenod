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
