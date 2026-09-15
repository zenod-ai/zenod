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
