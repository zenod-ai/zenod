import type {Classification} from '../llm/types.js';
import {resolveTopicSpans,semanticBounds,sourceWindows} from './sourcePassages.js';

/** Preserve only unambiguous reviews of this classifier call's owned passages.
 * Assigned reviews describe discovery, never accounting for every source clause. */
export function ownedFilingReviews(classification:Classification,window:ReturnType<typeof sourceWindows>[number]) {
 const reviews=classification.passageReviews??[];
 return reviews.filter(review=>review&&["assigned","evidence_only","unresolved"].includes(review.status)&&typeof review.passageId==="string"&&reviews.filter(other=>other?.passageId===review.passageId).length===1
  && window.passages.some(p=>p.id===review.passageId&&p.start>=window.range.start&&p.end<=window.range.end));
}

/** Receipt accounting only. Never infer complete clause coverage from expanded
 * qualifier context or the historic broad reviewedSourceSpans discovery ledger. */
export function unassignedFilingSpans(content:string,classification:Classification,semanticRange?:{start:number;end:number}) {
 const bounds=semanticBounds({content,...(semanticRange?{semanticRange}:{})});
 const covered:Array<{start:number;end:number}>=[];
 for(const topic of classification.topics??[]){
  if(topic.classificationFailed||topic.retryDiscovery)continue;
  const resolved=resolveTopicSpans(content,topic);
  if(!resolved.invalid&&!resolved.nonOwnedContext)covered.push(...resolved.spans);
 }
 const passages=[...new Map(sourceWindows({content,...(semanticRange?{semanticRange}:{})}).flatMap(window=>window.passages.filter(p=>p.start>=window.range.start&&p.end<=window.range.end)).map(p=>[p.id,p])).values()];
 const reviews=classification.passageReviews??[];
 for(const review of reviews){
  if(!review||review.status!=='evidence_only'||reviews.filter(other=>other?.passageId===review.passageId).length!==1)continue;
  const passage=passages.find(p=>p.id===review.passageId);if(passage)covered.push(passage);
 }
 let cursor=bounds.start;const uncovered:Array<{start:number;end:number}>=[];
 const clamped=covered.map(span=>({start:Math.max(bounds.start,span.start),end:Math.min(bounds.end,span.end)})).filter(span=>span.start<span.end);
 for(const span of [...clamped,{start:bounds.end,end:bounds.end}].sort((a,b)=>a.start-b.start)){
  if(span.start>cursor&&content.slice(cursor,span.start).trim())uncovered.push({start:cursor,end:span.start});
  cursor=Math.max(cursor,span.end);
 }
 return uncovered;
}

/** Decision-only retries do not revisit accepted passage reviews. Discovery
 * retries replace only the windows they actually reopen. */
export function mergeFilingReviews(prior:Classification, retried:Classification, windows:ReturnType<typeof sourceWindows>) {
 const replaced=new Set(windows.flatMap(window=>window.passages.filter(p=>p.start>=window.range.start&&p.end<=window.range.end).map(p=>p.id)));
 return [...(prior.passageReviews??[]).filter(review=>!replaced.has(review.passageId)),...(retried.passageReviews??[])];
}
