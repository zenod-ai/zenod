import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {executeScenario} from './scenario.mjs';import {modelScenario} from '../basics/policy.mjs';
const fixture=JSON.parse(readFileSync(new URL('../basics/fixture.json',import.meta.url)));
for(const original of fixture.cases)test(`unchanged ${original.id} action dispatcher and conversation/capture identities`,async()=>{
 const calls=[],jobs=new Map(),sources=new Map(),keys=new Map();let seq=0,reservations=0;const scenario=modelScenario(original),row={};
 const call=async(name,args)=>{calls.push({name,args:structuredClone(args)});if(name==='get_memory')return {entry:sources.get(args.path)};
  if(keys.has(args.idempotencyKey))return {jobId:keys.get(args.idempotencyKey)};
  const id='job'+(++seq);keys.set(args.idempotencyKey,id);let result={text:'offline unscored answer'};
  if(name==='store_memory'){result={evidenceRef:'Log/f#^e-'+id,revision:{id:'fake'}};sources.set(result.evidenceRef,{content:args.content});}
  jobs.set(id,{jobId:id,status:'done',result});return {jobId:id};};
 await executeScenario({tenant:{id:'m2-fixture'},key:original.id+':1'},scenario,{call,wait:async id=>jobs.get(id),reserve:async()=>reservations++,snapshot:async()=>({})},row);
 assert.deepEqual(calls.filter(c=>c.name==='chat_with_zenod').map(c=>c.args.message),scenario.turns.filter(t=>t.kind==='chat').map(t=>t.message));
 const stores=calls.filter(c=>c.name==='store_memory');for(const [i,memory]of scenario.memories.entries()){assert.equal(stores[i].args.content,memory.content);assert.equal(stores[i].args.capturedAt,memory.capturedAt);assert.equal(stores[i].args.contentType,memory.contentType);assert.equal(stores[i].args.verbatim,true);}
 const chats=calls.filter(c=>c.name==='chat_with_zenod');for(const [i,turn]of scenario.turns.filter(t=>t.kind==='chat').entries())assert.equal(chats[i].args.conversationKey,`m2-fixture:${original.id}:1:${turn.thread}`);
 if(original.id==='B05'){assert.equal(stores.length,2);assert.deepEqual(stores[0].args,stores[1].args);assert.equal(row.completedReplayStatus,'UNMEASURED');assert.deepEqual(row.duplicateReplay,{sameJob:true,sameResult:true,unchangedPages:true});}
 assert.equal(reservations,calls.filter(c=>['store_memory','chat_with_zenod'].includes(c.name)).length);
});
