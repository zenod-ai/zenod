import {expect,it} from 'vitest';
import {AnswerSupportRegistry} from '../src/engine/answerSupport.js';
import type {NotePassage} from '../src/ops/passage.js';
const path='Log/2026-09-15.md',ref=path+'#^e-123abc';
const body='## Capture ^e-123abc\n- source: test\n\n> '+('The proposal is tentative and attributed to the speaker. '.repeat(320))+'\n';
export function piece(start:number,end:number,version='same'):NotePassage{return {source:{path,url:'https://example.invalid',provider:'github'},readPath:ref,identity:ref,version,part:'body',frontmatterChars:0,body:body.slice(start,end),extent:{unit:'utf16',start,end,total:body.length,scopeStart:0,scopeEnd:body.length,sectionStart:0,sectionEnd:body.length},truncated:end<body.length||start>0,omittedBefore:start>0,nextCursor:end<body.length?`raw-${end}`:null};}
const pieces=Array.from({length:Math.ceil(body.length/4000)},(_,i)=>piece(i*4000,Math.min((i+1)*4000,body.length)));
it('issues a summary-only whole-source handle after all17k actually read with bounded metadata',()=>{
 expect(body.length).toBeGreaterThan(17000);const r=new AnswerSupportRegistry();let hints:any[]=[];
 for(const [i,p]of pieces.entries()){hints=r.addPassage(p);if(i<pieces.length-1)expect(hints.some(h=>h.kind==='source_summary')).toBe(false);}
 const summary=hints.find(h=>h.kind==='source_summary');expect(summary).toMatchObject({summaryOnly:true,modes:['raw_report']});
 expect(JSON.stringify(summary).length).toBeLessThan(400);expect(hints.length).toBeLessThanOrEqual(32);
 for(const summaryText of [undefined,null,'',' ', 'x'.repeat(1201)])expect(r.render([{id:summary.id,mode:'raw_report',summaryText} as any]).valid).toBe(false);
 const rendered=r.render([{id:summary.id,mode:'raw_report',summaryText:'The speaker is considering a proposal, not reporting a decision.'}]);expect(rendered.valid).toBe(true);expect(rendered.text).toContain(ref);expect(rendered.text).not.toContain(body);
 expect(r.selectedPassages([{id:summary.id,mode:'raw_report'}])[0]!.version).toBe('same');
});
it.each(['start','middle','tail','version','overlap','metadata','unanchored'])('refuses an incomplete or inconsistent complete-source handle: %s',mode=>{
 const r=new AnswerSupportRegistry();const sequence=pieces.filter((_,i)=>mode==='start'?i>0:mode==='middle'?i!==1:mode==='tail'?i<pieces.length-1:true).map((p,i)=>({...p,...(mode==='version'&&i===1?{version:'different'}:{}),...(mode==='unanchored'?{identity:path+'#section-0'}:{}),...(mode==='metadata'?{body:p.body.replaceAll('> ','- ')}:{})}));
 if(mode==='overlap')sequence.splice(1,0,{...piece(0,4000),body:'X'+body.slice(1,4000)});
 const hints=sequence.flatMap(p=>r.addPassage(p));expect(hints.some(h=>h.kind==='source_summary')).toBe(false);
});
it('reserves a global support slot and an emitted hint slot for a completed source',()=>{
 const r=new AnswerSupportRegistry();r.addPassage(pieces[0]!);
 for(let i=0;i<12;i++)r.addPassage({...pieces[0]!,identity:`Notes/${i}.md#section-0`,source:{...pieces[0]!.source,path:`Notes/${i}.md`},body:Array.from({length:40},(_,j)=>`- Requirement ${i}.${j}.`).join('\n')});
 let hints:any[]=[];for(const p of pieces.slice(1))hints=r.addPassage(p,1);
 expect(hints).toHaveLength(1);expect(hints[0].kind).toBe('source_summary');
});
