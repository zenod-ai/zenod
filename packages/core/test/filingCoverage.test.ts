import {expect,it} from 'vitest';
import {unassignedFilingSpans,ownedFilingReviews,mergeFilingReviews} from '../src/engine/filingCoverage.js';
import {sourceWindows,resolveTopicSpans} from '../src/engine/sourcePassages.js';
import type {Classification} from '../src/llm/types.js';
const content='The rent option remains tentative. Salary covers the opening mortgage costs.';
function setup(text=content){const window=sourceWindows({content:text})[0]!,quote=text.slice(0,text.indexOf('.')+1);const topic={topic:'First idea',summary:'First',confidence:1,disposition:'append_compact_note' as const,pages:[{path:'Areas/Home.md',title:'Home',action:'update' as const}],evidenceQuotes:[],evidenceAssignments:[{passageId:window.passages[0]!.id,quote,occurrence:0}],sourceRange:window.range,sourcePassages:window.passages};return {window,topic,classification:{topics:[topic],confidence:1,summary:'test',tags:[],pages:[],passageReviews:[{passageId:window.passages[0]!.id,status:'assigned'}],reviewedSourceSpans:[window.range]} as Classification};}
it('keeps an unassigned second idea visible despite assigned passage review and expanded qualification context',()=>{
 const {topic,classification}=setup();expect(resolveTopicSpans(content,topic,{completePropositions:true}).supportSpans).toEqual([expect.objectContaining({start:0,end:content.length})]);
 const spans=unassignedFilingSpans(content,classification);expect(spans).toEqual([{start:topic.evidenceAssignments[0]!.quote.length,end:content.length}]);expect(content.slice(spans[0]!.start)).toContain('Salary');
});
it.each(['needs_clarification','evidence_only'] as const)('accounts for a valid explicitly%s topic without assigning its neighboring clause',disposition=>{
 const {classification}=setup();classification.topics![0]!.disposition=disposition;classification.topics![0]!.pages=[];
 expect(unassignedFilingSpans(content,classification)).toHaveLength(1);expect(unassignedFilingSpans(content,classification)[0]!.start).toBeGreaterThan(0);
});
it.each(['invalid','placeholder','failed'] as const)('does not hide source through%s topics or legacy broad review spans',mode=>{
 const {classification}=setup();if(mode==='invalid')classification.topics![0]!.evidenceAssignments![0]!.quote='Invented';if(mode==='placeholder')classification.topics![0]!.retryDiscovery=true;if(mode==='failed')classification.topics![0]!.classificationFailed=true;
 expect(unassignedFilingSpans(content,classification)).toEqual([{start:0,end:content.length}]);
});
it('accepts only unique explicit evidence-only reviews of canonical host passages',()=>{
 const {classification,window}=setup();classification.topics=[];classification.passageReviews=[{passageId:window.passages[0]!.id,status:'evidence_only'}];expect(unassignedFilingSpans(content,classification)).toEqual([]);
 for(const reviews of [[{passageId:'invented',status:'evidence_only'}],[...classification.passageReviews,...classification.passageReviews],[...classification.passageReviews,{passageId:window.passages[0]!.id,status:'assigned'}]])expect(unassignedFilingSpans(content,{...classification,passageReviews:reviews as any})).toEqual([{start:0,end:content.length}]);
});
it('rejects neighbor reviews before merge while preserving each window own explicit decisions',()=>{
 const windows=sourceWindows({content:'A source sentence. '.repeat(1400)}),first=windows[0]!;const neighbor=first.passages.find(p=>p.start>=first.range.end)!;
 const classification={passageReviews:[{passageId:first.passages[0]!.id,status:'evidence_only'},{passageId:neighbor.id,status:'evidence_only'}]} as Classification;
 expect(ownedFilingReviews(classification,first)).toEqual([classification.passageReviews![0]]);
 expect(ownedFilingReviews({...classification,passageReviews:[classification.passageReviews![0]!,classification.passageReviews![0]!]},first)).toEqual([]);
});
it('clamps receipt remainder to semantic source and conservatively handles old receipts without explicit reviews',()=>{
 const wrapped='Transport header. '+content+' Transport tail.',start=18,end=start+content.length;
 const {classification}=setup(wrapped);classification.topics=[];delete classification.passageReviews;
 expect(unassignedFilingSpans(wrapped,classification,{start,end})).toEqual([{start,end}]);
});

it('preserves accepted evidence-only sibling reviews during decision-only repair and replaces only rediscovery windows',()=>{
 const {classification,window}=setup();classification.passageReviews=[{passageId:window.passages[0]!.id,status:'evidence_only'}];
 const repaired={...classification,passageReviews:[]} as Classification;
 const retained=mergeFilingReviews(classification,repaired,[]);expect(retained).toEqual(classification.passageReviews);
 expect(unassignedFilingSpans(content,{...classification,topics:[],passageReviews:retained})).toEqual([]);
 expect(mergeFilingReviews(classification,repaired,[window])).toEqual([]);
});
