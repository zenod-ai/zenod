/** Existing frozen memories + chat/interrupted_filing actions, without rubric inputs. */
export async function executeScenario(m,scenario,{call,wait,reserve,snapshot},row){
 row.turns=[];row.captures=[];row.chatEnrichmentJobs=[];
 const readCapture=async(result,message,job)=>{
  if(!result?.evidenceRef)throw Error('capture_missing');
  let enriched=job;
  if(result.organization){if(result.organization.status!=='queued'||!result.organization.jobId)throw Error('capture_job_missing');enriched=await wait(result.organization.jobId);row.chatEnrichmentJobs.push(enriched);}
  const raw=await call('get_memory',{path:result.evidenceRef});row.captures.push({message,capture:result,enriched,raw});return row.captures.at(-1);
 };
 const store=async memory=>{
  const args={content:memory.content,source:'mcp',contentType:memory.contentType,capturedAt:memory.capturedAt,sourceId:`${m.tenant.id}:${m.key}:${memory.id}`,idempotencyKey:`${m.tenant.id}:${m.key}:store:${memory.id}`,verbatim:true};
  await reserve();const queued=await call('store_memory',args),id=queued.jobId??queued.ticket_id;if(!id)throw Error('store_job_missing');const terminal=await wait(id);await readCapture(terminal.result,memory.content,terminal);return {args,id,terminal};
 };
 for(const memory of scenario.memories)await store(memory);
 row.pagesAfterSetup=await snapshot();
 for(const [index,turn]of scenario.turns.entries()){
  if(turn.kind==='chat'){
   await reserve();const queued=await call('chat_with_zenod',{message:turn.message,surface:'mcp',conversationKey:`${m.tenant.id}:${m.key}:${turn.thread}`,testRunId:m.tenant.id,idempotencyKey:`${m.tenant.id}:${m.key}:turn-${index}`});
   const id=queued.jobId??queued.ticket_id;if(!id)throw Error('chat_job_missing');const terminal=await wait(id);row.turns.push({message:turn.message,thread:turn.thread,result:terminal.result});
   if(terminal.result?.stored)await readCapture(terminal.result.stored,turn.message,terminal);
  }else if(turn.kind==='interrupted_filing'){
   // Supported duplicate leg only; no injected production fault or direct job editing.
   const first=await store(turn.memory),before=await snapshot();
   await reserve();const again=await call('store_memory',first.args),id=again.jobId??again.ticket_id;
   if(id!==first.id)throw Error('duplicate_job_created');const repeated=await wait(id),after=await snapshot();
   row.duplicateReplay={sameJob:true,sameResult:JSON.stringify(first.terminal.result)===JSON.stringify(repeated.result),unchangedPages:JSON.stringify(before)===JSON.stringify(after)};
   row.completedReplayStatus='UNMEASURED';row.interruptionProof='ISOLATED_CANDIDATE_REQUIRED';
  }else throw Error('unsupported_frozen_action');
 }
 row.pagesAfter=await snapshot();
}
