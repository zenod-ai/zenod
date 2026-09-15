import type {SourcePassage} from './types.js';

type Unit={id:string;start:number;end:number;text:string;selectable:boolean;run:number};
const terminal=/[.!?。！？]["'”’)]*\s*$/u;
const list=/^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+\S/m;
/** Request-local formatting units, not semantic entailment. Every byte appears
 * once, including context-only incomplete/overlong edges. Adjacent qualifiers
 * must be selected together by the classifier; no text is regenerated. */
export function classificationSourceUnits(passages:SourcePassage[],owned?:{start:number;end:number}) {
 const runs:Array<{start:number;end:number;text:string;passages:SourcePassage[]}>=[];
 for(const p of [...passages].sort((a,b)=>a.start-b.start)){
  if(!Number.isSafeInteger(p.start)||!Number.isSafeInteger(p.end)||p.start<0||p.end-p.start!==p.text.length||!p.text.length)throw new Error('source_unit_context_invalid');
  const last=runs.at(-1);if(last&&p.start<last.end)throw new Error('source_unit_context_overlap');
  if(last&&p.start===last.end){last.end=p.end;last.text+=p.text;last.passages.push(p);}else runs.push({start:p.start,end:p.end,text:p.text,passages:[p]});
 }
 const units:Unit[]=[];
 for(const [runIndex,run]of runs.entries()){
  const starts=[0,...[...run.text.matchAll(/\r?\n[ \t]*\r?\n/g)].map(m=>m.index!+m[0].length)];
  const blocks:Array<{start:number;end:number}>=[];
  for(const [i,start]of starts.entries()){
   const end=starts[i+1]??run.text.length,previous=blocks.at(-1),text=run.text.slice(start,end);
   if(previous&&((list.test(run.text.slice(previous.start,previous.end))&&/^[ \t]+\S/.test(text))||(/:\s*$/.test(run.text.slice(previous.start,previous.end))&&list.exec(text)?.index===0)))previous.end=end;
   else blocks.push({start,end});
  }
  const extents:Array<{start:number;end:number}>=[];
  for(const block of blocks){
   const text=run.text.slice(block.start,block.end),marker=list.exec(text);
   if(marker){
    const offsets=marker.index===0?[...text.matchAll(/^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+\S/gm)].filter(m=>m[1]!.length<=marker[1]!.length).map(m=>m.index!):[0];
    offsets.forEach((at,i)=>extents.push({start:block.start+at,end:block.start+(offsets[i+1]??text.length)}));
   }else{
    let start=block.start;
    for(const part of new Intl.Segmenter(undefined,{granularity:'sentence'}).segment(text)){
     if(terminal.test(part.segment)){const end=block.start+part.index+part.segment.length;extents.push({start,end});start=end;}
    }
    if(start<block.end){const prior=extents.at(-1);if(prior&&prior.end===start&&prior.start>=block.start)prior.end=block.end;else extents.push({start,end:block.end});}
   }
  }
  for(const extent of extents){
   const text=run.text.slice(extent.start,extent.end),start=run.start+extent.start,end=run.start+extent.end;
   const clippedStart=!run.text.slice(0,extent.start).trim()&&(runIndex>0||!!owned&&run.start<owned.start);
   const clippedEnd=!run.text.slice(extent.end).trim()&&(runIndex<runs.length-1||!!owned&&run.end>owned.end&&!terminal.test(text));
   if(units.length>=255&&units.at(-1)?.run===runIndex){const tail=units.at(-1)!;tail.end=end;tail.text+=text;tail.selectable=false;continue;}
   units.push({id:`u${units.length+1}`,start,end,text,run:runIndex,selectable:units.length<256&&!!text.trim()&&text.trim().length<=1600&&!clippedStart&&!clippedEnd});
  }
 }
 const ids=units.filter(u=>u.selectable).map(u=>u.id);
 return {
  ids,
  table:{passages:passages.map(({id,start,end})=>({id,start,end})),units:units.map(unit=>[unit.selectable?unit.id:null,unit.start,unit.end,unit.text] as const)},
  assignments(selected:string[]){
   const selectedUnits=[...new Set(selected)].map(id=>units.find(u=>u.id===id&&u.selectable));
   if(selectedUnits.some(u=>!u))throw new Error('source_unit_selection_invalid');
   const groups:Array<{start:number;end:number;run:number}>=[];
   for(const unit of selectedUnits.filter((u):u is Unit=>!!u).sort((a,b)=>a.start-b.start)){
    const prior=groups.at(-1);if(prior&&prior.run===unit.run&&prior.end===unit.start)prior.end=unit.end;else groups.push({start:unit.start,end:unit.end,run:unit.run});
   }
   return groups.map(group=>{
    const run=runs[group.run]!,raw=run.text.slice(group.start-run.start,group.end-run.start),quote=raw.trim();
    const start=group.start+raw.length-raw.trimStart().length,end=start+quote.length;
    if(!quote)throw new Error('source_unit_selection_invalid');
    const addressed=run.passages.find(p=>p.start<end&&p.end>start&&(!owned||p.start<owned.end&&p.end>owned.start))??run.passages.find(p=>p.start<end&&p.end>start)!;
    const matches:number[]=[];for(let at=run.text.indexOf(quote);at>=0;at=run.text.indexOf(quote,at+1)){const global=run.start+at;if(global<addressed.end&&global+quote.length>addressed.start)matches.push(global);}
    const occurrence=matches.indexOf(start);if(occurrence<0)throw new Error('source_unit_selection_invalid');
    return {passageId:addressed.id,quote,occurrence};
   });
  },
 };
}
