import {it,expect} from 'vitest';
import {ClassificationDecisions} from '../src/engine/classificationDecisions.js';
import type {Classification,ClassificationTopic,ClassifyInput} from '../src/llm/types.js';
const content='Mina waters on Tuesday. If it rains, Mina checks the drain. Other idea.';
const host:ClassifyInput={content,hints:[],pageIndex:[],tagVocabulary:[],sourceRange:{start:0,end:content.length},sourcePassages:[{id:'p',start:0,end:content.length,text:content}]};
const topic=(name:string,quote:string):ClassificationTopic=>({topic:name,summary:name,evidenceQuotes:[],evidenceAssignments:[{passageId:'p',quote,occurrence:0}],pages:[{path:'Projects/Garden.md',title:'Garden',action:'update'}],confidence:.9,disposition:'append_compact_note'});
const result=(topics:ClassificationTopic[]):Classification=>({topics,pages:[],summary:'Garden',confidence:.9,tags:[]});
it('retains valid siblings through an invalid shared-passage decision and malformed retry',()=>{
 const s=new ClassificationDecisions(content,host);
 const good=topic('Schedule','Mina waters on Tuesday.'),bad=topic('Rain','Invented source.');
 const first=s.accept(result([good,bad]));expect(first.topics![0]!.classificationFailed).toBeUndefined();expect(first.topics![1]!.question).toContain('classification_source_address_invalid');
 const retry=s.input(host);expect(retry.retryDecisions).toHaveLength(1);expect(retry.retryDecisions![0]!.topic.topic).toBe('Rain');
 s.unavailable(new Error('classify: structured_output_invalid'));
 const final=s.result()!;expect(final.topics![0]).toEqual(first.topics![0]);expect(final.topics![1]!.question).toContain('structured_output_invalid');
});
it('only a named unresolved decision may be repaired; accepted IDs cannot be replaced',()=>{
 const s=new ClassificationDecisions(content,host);const first=s.accept(result([topic('Schedule','Mina waters on Tuesday.'),topic('Rain','bad')]));
 const pending=s.input(host).retryDecisions![0]!;
 const done=s.accept(result([{...topic('Changed valid label','If it rains, Mina checks the drain.'),retryId:pending.id},{...topic('Attack','Other idea.'),retryId:first.topics![0]!.retryId}]));
 expect(done.topics).toHaveLength(2);expect(done.topics![0]).toEqual(first.topics![0]);expect(done.topics![1]!.classificationFailed).toBeUndefined();
});
it('rejects duplicate or missing retry IDs and keeps valid prior optional-refinement decisions',()=>{
 const s=new ClassificationDecisions(content,host);const first=s.accept(result([{...topic('Unknown','Other idea.'),confidence:.4,disposition:'needs_clarification',pages:[],question:'Which project?'}]));
 const id=s.input(host).retryDecisions![0]!.id;
 expect(s.accept(result([{...topic('Invalid','invented'),retryId:id}])).topics).toEqual(first.topics);
 expect(s.accept(result([{...topic('A','Other idea.'),retryId:id},{...topic('B','Other idea.'),retryId:id}])).topics).toEqual(first.topics);
});

it('restores a legacy whole-window failure as discovery of multiple ideas, not one atomic replacement',()=>{
 const legacy:ClassificationTopic={topic:'Unclassified segment 1',summary:'classification pending',evidenceQuotes:[content],sourceRange:host.sourceRange!,classificationFailed:true,pages:[],confidence:0,disposition:'needs_clarification',ideaId:'legacy-sentinel'};
 const s=new ClassificationDecisions(content,host,[legacy]);const input=s.input(host);expect(input.retryDecisions![0]!.scope).toBe('source_window');
 const id=input.retryDecisions![0]!.id;const result=s.accept({topics:[{...topic('Schedule','Mina waters on Tuesday.'),retryId:id},{...topic('Rain','If it rains, Mina checks the drain.'),retryId:id}],pages:[],summary:'',confidence:.9,tags:[]});
 expect(result.topics).toHaveLength(2);expect(new Set(result.topics!.map(t=>t.retryId)).size).toBe(2);expect(result.topics!.every(t=>!t.classificationFailed&&!t.ideaId)).toBe(true);
});
it('does not admit unknown retry IDs or erase the original cause when a required decision is omitted',()=>{
 const s=new ClassificationDecisions(content,host);s.accept(result([topic('Broken','not real')]));s.input(host);
 const after=s.accept(result([{...topic('Unknown','Other idea.'),retryId:'not-owned'}]));
 expect(after.topics).toHaveLength(1);expect(after.topics![0]!.topic).toBe('Broken');expect(after.topics![0]!.question).toContain('classification_source_address_invalid');expect(after.topics![0]!.question).toContain('classification_retry_decision_missing');
});

it('bounds corrective previews without dropping unrequested pending state or duplicating the full raw window',()=>{
 const s=new ClassificationDecisions(content,host);s.accept(result(Array.from({length:40},(_,i)=>({...topic(`Pending ${i}`,'invalid'.repeat(300)),summary:'context'.repeat(1000)}))));
 const input=s.input(host);expect(input.retryDecisions!.length).toBeGreaterThan(0);expect(input.retryDecisions!.length).toBeLessThanOrEqual(24);expect(JSON.stringify(input.retryDecisions).length).toBeLessThanOrEqual(12000);
 expect(input.sourcePassages).toEqual(host.sourcePassages);expect(s.result()!.topics).toHaveLength(40);
});

it.each([true,false])('allows a supplied neighboring qualifier for an owned retry overlap (discovery=%s)',discovery=>{
 const raw='A claim, but only if approved.';
 const range={start:0,end:9};
 const splitHost:ClassifyInput={...host,content:raw,sourceRange:{start:0,end:raw.length},sourcePassages:[{id:'p1',...range,text:raw.slice(0,9)},{id:'p2',start:9,end:raw.length,text:raw.slice(9)}]};
 const pending:ClassificationTopic={...topic('Qualified claim','invalid'),classificationFailed:true,question:'classification_source_address_invalid',retrySourceRange:range,...(discovery?{retryDiscovery:true}:{}),sourceRange:splitHost.sourceRange!};
 const s=new ClassificationDecisions(raw,splitHost,[pending]);const id=s.input(splitHost).retryDecisions![0]!.id;
 const repaired=s.accept(result([{...topic('Qualified claim',raw),retryId:id,evidenceAssignments:[{passageId:'p1',quote:raw,occurrence:0}]}]));
 expect(repaired.topics![0]!.classificationFailed).toBeUndefined();expect(repaired.topics![0]!.evidenceAssignments![0]!.quote).toBe(raw);
});
it.each([true,false])('rejects a quote wholly outside the requested retry scope (discovery=%s)',discovery=>{
 const raw='A claim, but only if approved.';const range={start:0,end:9};
 const splitHost:ClassifyInput={...host,content:raw,sourceRange:{start:0,end:raw.length},sourcePassages:[{id:'p1',...range,text:raw.slice(0,9)},{id:'p2',start:9,end:raw.length,text:raw.slice(9)}]};
 const s=new ClassificationDecisions(raw,splitHost,[{...topic('Pending','invalid'),classificationFailed:true,retrySourceRange:range,...(discovery?{retryDiscovery:true}:{})}]);
 const id=s.input(splitHost).retryDecisions![0]!.id;
 const rejected=s.accept(result([{...topic('Neighbor',raw.slice(9)),retryId:id,evidenceAssignments:[{passageId:'p2',quote:raw.slice(9),occurrence:0}]}]));
 expect(rejected.topics![0]!.classificationFailed).toBe(true);expect(rejected.topics![0]!.question).toContain('classification_retry_source_scope_invalid');
});

it.each([false,true])('accepts empty discovery reviews only without unowned proposed topics (unknown=%s)',unknown=>{
 const pending:ClassificationTopic={...topic('Unclassified','invalid'),classificationFailed:true,question:'classification_assigned_passage_unsupported',retryDiscovery:true,retrySourceRange:host.sourceRange!};
 const s=new ClassificationDecisions(content,host,[pending]);s.input(host);
 const after=s.accept({...result(unknown?[{...topic('Unowned substantive idea','Other idea.'),retryId:'unknown'}]:[]),passageReviews:[{passageId:'p',status:'evidence_only'}]});
 if(unknown){
   expect(after.topics).toHaveLength(1);expect(after.topics![0]!.classificationFailed).toBe(true);expect(after.topics![0]!.question).toContain('classification_assigned_passage_unsupported');
   expect(after.passageReviews?.some(review=>review.status==='evidence_only')??false).toBe(false);
 }else{expect(after.topics).toEqual([]);expect(after.passageReviews).toEqual([{passageId:'p',status:'evidence_only'}]);}
});
