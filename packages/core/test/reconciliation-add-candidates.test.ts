import {expect,it} from 'vitest';
import {prepareReconciliation,applyReconciliation,type ReconciliationOperation} from '../src/engine/reconciliation.js';
import {parseNote} from '../src/vault/frontmatter.js';
import {parseMemoryFacts} from '../src/engine/temporalFacts.js';
const raw='# Test\n\nExisting history.\n[[Index]]\n';
function prepare(texts:string[],owners:string[][]=texts.map((_,i)=>[`idea${i}`])){
 const content=texts.join('\n\n');let start=0;
 const sources=texts.map((text,i)=>{const source={id:`s${i}`,start,end:start+text.length,text};start=source.end+2;return source;});
 const ideas=[...new Set(owners.flat())].map(id=>({id,topic:id,sourceIds:sources.filter((_,i)=>owners[i]!.includes(id)).map(s=>s.id)}));
 return prepareReconciliation({path:'Projects/Test.md',raw,title:'Test',type:'project',today:'2026-09-15',sourceContent:content,
  evidence:{content,evidenceRef:'Log/2026-09-15.md#^e-123abc',path:'Log/2026-09-15.md',anchor:'e-123abc',title:'source',source:'mcp',verbatim:true,capturedAt:'2026-09-15T00:00:00Z',url:'https://example.invalid',provider:'github'},
  sources,ideas,addCandidates:sources.map((source,i)=>({...source,ideaIds:owners[i]!})),
  context:{branches:[],partial:false,omitted:[],omittedCount:0,contextChars:0,estimatedTokens:0},links:['[[Index]]']});
}
const add=(sourceIds:string[],ideaIds:string[],sourceQuote='Regenerated, unsupported text.'):ReconciliationOperation=>({kind:'add',sourceIds,ideaIds,sourceQuote,targetId:null,factKey:'test.claim',correctionQuote:null,reason:null});
it('renders canonical raw qualifiers despite regenerated spaces, punctuation or omitted model text',async()=>{
 const source='The trial may proceed.Only if approved, Mina checks the drain.\nThis is not a decision yet.';
 const prepared=prepare([source]);expect(prepared.request.sources[0]!.text).toBe(source);expect(prepared.request.addCandidates![0]!.text).toBe(source);
 const a=await applyReconciliation(prepared,[add(['s0'],['idea0'],'The trial proceeds.')]);
 const b=await applyReconciliation(prepared,[add(['s0'],['idea0'],'The trial may proceed. Only if approved, Mina checks the drain.')]);
 expect(a.pending).toEqual([]);expect(a.content).toBe(b.content);expect(a.appliedOperationIds).toEqual(b.appliedOperationIds);
 expect(parseMemoryFacts(parseNote(a.content).frontmatter!.memoryFacts)[0]!.statement).toBe(source);
 const replay=await applyReconciliation(prepareReconciliation({...prepared.input,raw:a.content}),[add(['s0'],['idea0'],'Different generated text.')]);
 expect(replay.content).toBe(a.content);
});
it('keeps disjoint selected candidates as separate raw additions in one atomic idea group',async()=>{
 const texts=['Only if approved, Mina checks the drain.','The pump might cost 20; this is unconfirmed.'];const prepared=prepare(texts,[['idea'],['idea']]);
 const result=await applyReconciliation(prepared,[add(['s0','s1'],['idea'],'Stitched invented quote.')]);
 expect(result.pending).toEqual([]);expect(parseMemoryFacts(parseNote(result.content).frontmatter!.memoryFacts).map(f=>f.statement)).toEqual(texts);
 const failed=await applyReconciliation(prepared,[add(['s0','missing'],['idea'])]);expect(failed.content).toBe(raw);expect(failed.pending[0]!.reason).toBe('add_candidate_unavailable');
});
it('rejects another idea candidate without rolling back a healthy independent idea',async()=>{
 const prepared=prepare(['The drain check is provisional.','The pump budget is approved.']);
 const result=await applyReconciliation(prepared,[add(['s1'],['idea0']),add(['s1'],['idea1'])]);
 expect(result.pending.some(p=>p.ideaIds.includes('idea0')&&p.reason==='add_candidate_idea_mismatch')).toBe(true);
 expect(result.appliedOperations.flatMap(o=>o.ideaIds)).toEqual(['idea1']);
 expect(result.content).toContain('The pump budget is approved.');
 expect(result.content).not.toContain('The drain check is provisional.');
 const independent=await applyReconciliation(prepared,[add(['missing'],['idea0']),add(['s1'],['idea1'])]);
 expect(independent.appliedOperations.flatMap(o=>o.ideaIds)).toEqual(['idea1']);
});
it('deduplicates the identical candidate span while completing equivalent covered ideas',async()=>{
 const prepared=prepare(['A qualified new rule applies only on weekdays.'],[['A','B']]);
 const result=await applyReconciliation(prepared,[add(['s0'],['A']),add(['s0'],['B'])]);
 expect(result.pending).toEqual([]);expect(parseMemoryFacts(parseNote(result.content).frontmatter!.memoryFacts)).toHaveLength(1);expect(result.appliedOperations.flatMap(o=>o.ideaIds)).toEqual(['A','B']);
});
it('fails closed for absent, oversized, ambiguous and malformed candidate proofs',async()=>{
 const seed=prepare(['A real source quote.']);
 for(const addCandidates of [undefined,[{...seed.input.addCandidates![0]!,text:'Invented'}],[seed.input.addCandidates![0]!,seed.input.addCandidates![0]!]]){
  const input={...seed.input};if(addCandidates)input.addCandidates=addCandidates;else delete input.addCandidates;
  const result=await applyReconciliation(prepareReconciliation(input),[add(['s0'],['idea0'])]);expect(result.content).toBe(raw);expect(result.pending).toHaveLength(1);
 }
 const long=prepare(['x'.repeat(1601)]);const result=await applyReconciliation(long,[add(['s0'],['idea0'])]);expect(result.pending[0]!.reason).toBe('add_candidate_too_long');expect(result.content).toBe(raw);
});
it('packs a candidate with its qualifier context and preserves a small sibling after budget exhaustion',async()=>{
 const prepared=prepare(['x'.repeat(16000),'A small complete conditional rule applies only on Tuesday.']);
 expect(JSON.stringify(prepared.request.sources).length+JSON.stringify(prepared.request.addCandidates).length).toBeLessThanOrEqual(16000);
 const result=await applyReconciliation(prepared,[add(['s0'],['idea0']),add(['s1'],['idea1'])]);
 expect(result.appliedOperations.flatMap(o=>o.ideaIds)).toEqual(['idea1']);expect(result.pending[0]!.ideaIds).toEqual(['idea0']);
});
