import {expect,it} from 'vitest';
import {classificationSourceUnits} from '../src/llm/classificationSourceUnits.js';
import {resolveTopicSpans,sourceWindows} from '../src/engine/sourcePassages.js';
function setup(text:string,cut=800){const passages=Array.from({length:Math.ceil(text.length/cut)},(_,i)=>({id:`p${i}`,start:i*cut,end:Math.min((i+1)*cut,text.length),text:text.slice(i*cut,(i+1)*cut)}));return {passages,units:classificationSourceUnits(passages,{start:0,end:text.length})};}
function topic(assignments:any,passages:any,range:any){return {topic:'test',evidenceQuotes:[],evidenceAssignments:assignments,sourcePassages:passages,sourceRange:range} as any;}
it('selects exact lowercase numbers and contiguous qualification across original passage boundaries',()=>{
 const text='I could borrow300k. But only if paid interest stays affordable.';const {units,passages}=setup(text,24);
 expect(units.ids).toHaveLength(2);const assignments=units.assignments(units.ids);
 expect(assignments).toHaveLength(1);expect(assignments[0]!.quote).toBe(text);expect(assignments[0]!.quote).not.toContain('300K');
 const resolved=resolveTopicSpans(text,topic(assignments,passages,{start:0,end:text.length}));expect(resolved.invalid).toBe(false);expect(resolved.spans).toEqual([{start:0,end:text.length,passageId:assignments[0]!.passageId}]);
 expect(units.table.units.map(u=>u[3]).join('')).toBe(text);expect(units.assignments([...units.ids,...units.ids])).toEqual(assignments);
});
it('retains list continuation qualifiers and attribution as one unit',()=>{
 const text='- Loan estimate300k\n  Only if income permits.\n\n  This remains tentative.\n- Other option150k\n  Subject to approval.';
 const {units}=setup(text);expect(units.ids).toHaveLength(2);expect(units.assignments(['u1'])[0]!.quote).toContain('This remains tentative.');
 const attributed=setup('Rejected proposals:\n- Borrow without income.\n- Ignore interest.').units;expect(attributed.ids).toHaveLength(1);expect(attributed.assignments(attributed.ids)[0]!.quote).toContain('Rejected proposals:');
});
it('keeps disjoint selections separate and rejects unknown IDs without joining gaps',()=>{
 const {units}=setup('First claim. Middle qualifier. Last claim.');expect(units.assignments(['u1','u3'])).toHaveLength(2);expect(()=>units.assignments(['invented'])).toThrow('source_unit_selection_invalid');
 const p=[{id:'a',start:0,end:12,text:'First claim.'},{id:'b',start:20,end:31,text:'Last claim.'}];const g=classificationSourceUnits(p);expect(g.ids).toEqual([]);expect(g.table.units.map(u=>u[3])).toEqual(p.map(p=>p.text));
 expect(()=>classificationSourceUnits([p[0]!,{...p[0]!,id:'overlap'}])).toThrow('source_unit_context_overlap');
});
it('retains existing occurrence and owned-window proof rather than assigning neighboring text',()=>{
 const text='Repeated claim. Repeated claim. Neighbor report.';const {passages}=setup(text);const units=classificationSourceUnits(passages,{start:0,end:16});
 const assignment=units.assignments(['u2']);expect(assignment[0]!.occurrence).toBe(1);
 expect(resolveTopicSpans(text,topic(assignment,passages,{start:0,end:16})).invalid).toBe(true);
});
it('keeps overlong/context-only text visible without fabricated selectors and does not split long selections',()=>{
 const raw='x'.repeat(1800),one=setup(raw).units;expect(one.ids).toEqual([]);expect(one.assignments([])).toEqual([]);expect(one.table.units.map(u=>u[3]).join('')).toBe(raw);
 const text='A'.repeat(900)+'. '+'B'.repeat(900)+'.';const many=setup(text).units;expect(many.ids).toHaveLength(2);expect(many.assignments(many.ids)[0]!.quote).toHaveLength(text.length);
});
it('caps selector metadata and keeps text once without clipping raw bytes',()=>{
 const raw='One. '.repeat(1000);const {units}=setup(raw);expect(units.ids.length).toBeLessThanOrEqual(256);expect(units.table.units.length).toBeLessThanOrEqual(256);expect(JSON.stringify(units.table).length-raw.length).toBeLessThan(8000);expect(units.table.units.map(u=>u[3]).join('')).toBe(raw);
});
it('does not issue an incomplete neighbor edge but keeps crossing complete owned units',()=>{
 const text='clipped beginning. Owned condition remains tentative.\n\nunfinished tail';const {passages}=setup(text,20);const units=classificationSourceUnits(passages,{start:20,end:53});
 expect(units.table.units[0]![0]).toBeNull();expect(units.table.units.at(-1)![0]).toBeNull();expect(units.ids).toEqual(['u2']);
 expect(resolveTopicSpans(text,topic(units.assignments(['u2']),passages,{start:20,end:53})).invalid).toBe(false);
});

it('keeps whitespace-prefixed unknown gap edges context-only while interior units remain selectable',()=>{
 const first='First complete. End may be cut',second='\n\njected claim:\nBorrow immediately. Interior complete claim. Later complete claim. Last may be cut';
 const passages=[{id:'a',start:0,end:first.length,text:first},{id:'b',start:100,end:100+second.length,text:second},{id:'c',start:300,end:314,text:'Other partial.'}];
 const units=classificationSourceUnits(passages,{start:0,end:314});
 const selected=units.assignments(units.ids).map(a=>a.quote);expect(selected).toContain('Interior complete claim.');expect(selected.some(q=>q.includes('Borrow immediately'))).toBe(false);expect(selected.some(q=>q.includes('Last may be cut'))).toBe(false);
});
