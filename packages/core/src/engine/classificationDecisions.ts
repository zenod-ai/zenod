import {createHash} from 'node:crypto';
import type {Classification,ClassificationTopic,ClassifyInput} from '../llm/types.js';
import {checkTopicDestinations,checkTopicSourceAddresses} from './classificationContract.js';
import {resolveTopicSpans} from './sourcePassages.js';

/** One source window's existing retry state. Never matches model wording or shared
 * passage IDs to an idea: corrective responses must echo an explicit owned ID. */
export class ClassificationDecisions {
  private current:Classification|null=null;
  private requested=new Set<string>();
  constructor(private readonly content:string,private readonly host:ClassifyInput,prior?:ClassificationTopic[]){
    if(prior?.length)this.current={topics:prior.map((topic,index)=>({...structuredClone(topic),retryId:topic.retryId??this.id(index),...(this.isWindow(topic)?{retryDiscovery:true,retrySourceRange:topic.retrySourceRange??this.host.sourceRange!}:{})})),pages:[],confidence:0,summary:'Retry unresolved classification',tags:[]};
  }
  private isWindow(topic:ClassificationTopic):boolean {
    const range=this.host.sourceRange;
    return !!topic.retryDiscovery || !!(range && topic.classificationFailed && !topic.evidenceAssignments && !topic.pages.length
      && topic.evidenceQuotes.length===1 && topic.evidenceQuotes[0]===this.content.slice(range.start,range.end));
  }
  private id(index:number){return 'cd_'+createHash('sha256').update(JSON.stringify([this.host.sourceRange??null,index])).digest('hex').slice(0,24);}
  private unresolved(topic:ClassificationTopic){return topic.classificationFailed||topic.disposition==='needs_clarification'||topic.confidence<.7||topic.pages.some(page=>page.action==='create');}
  input(input:ClassifyInput):ClassifyInput {
    const failed=this.current?.topics?.filter(topic=>topic.classificationFailed);
    const pending=failed?.length?failed:this.current?.topics?.filter(topic=>this.unresolved(topic));
    const retryDecisions:NonNullable<ClassifyInput["retryDecisions"]>=[];
    for(const topic of pending??[]){
      // Prior proposals are hints, not evidence. Keep the full original passage
      // table shared once; bounded previews must never be used as source proof.
      const decision:ClassificationTopic={topic:topic.topic.slice(0,256),summary:topic.summary.slice(0,256),
        confidence:topic.confidence,disposition:topic.disposition,pages:topic.pages.slice(0,4).map(page=>({path:page.path.slice(0,512),title:page.title.slice(0,256),action:page.action})),
        evidenceQuotes:topic.retryDiscovery?[]:topic.evidenceQuotes.slice(0,2).map(quote=>quote.slice(0,400)),
        ...(topic.evidenceAssignments?{evidenceAssignments:topic.evidenceAssignments.slice(0,2).map(a=>({...a,quote:a.quote.slice(0,400)}))}:{}),
        ...(topic.retrySourceRange?{retrySourceRange:topic.retrySourceRange}:{}),
        ...(topic.question?{question:topic.question.slice(0,512)}:{})};
      const row={id:topic.retryId!,topic:decision,scope:topic.retryDiscovery?"source_window" as const:"decision" as const,
        reason:(topic.classificationFailed?topic.question??'classification_unavailable':topic.question??'destination_refinement').slice(0,512)};
      if(retryDecisions.length>=24 || JSON.stringify([...retryDecisions,row]).length>12000)break;
      retryDecisions.push(row);
    }
    this.requested=new Set(retryDecisions.map(decision=>decision.id));
    return retryDecisions.length?{...input,retryDecisions}:input;
  }

  private validate(topic:ClassificationTopic):ClassificationTopic {
    const copy:ClassificationTopic={...topic};
    delete copy.sourceRange;delete copy.sourcePassages;
    if(this.host.sourceRange)copy.sourceRange=this.host.sourceRange;
    if(this.host.sourcePassages)copy.sourcePassages=this.host.sourcePassages;
    delete copy.classificationFailed;delete copy.ideaId;delete copy.retryDiscovery;delete copy.retrySourceRange;
    const sample={topics:[copy],pages:[],summary:'',tags:[],confidence:copy.confidence};
    const address=checkTopicSourceAddresses(sample,this.content,this.host,true).topics![0]!;
    const source=resolveTopicSpans(this.content,copy);
    const destination=checkTopicDestinations(sample,true).topics![0]!;
    const reasons=[...(address.classificationFailed||source.invalid&&!source.nonOwnedContext?['classification_source_address_invalid']:[]),...(destination.classificationFailed?['classification_topic_destination_missing']:[])];
    return reasons.length?{...copy,classificationFailed:true,confidence:0,disposition:'needs_clarification',question:reasons.join('; ')}:copy;
  }
  accept(raw:Classification):Classification {
    if(!raw.topics)return this.current??raw; // Legacy top-level implementations retain their contract.
    if(!this.current){
      this.current={...raw,topics:raw.topics.map((topic,index)=>({...this.validate(topic),retryId:this.id(index)}))};
    }else{
      const offered=raw.topics;
      const topics=this.current.topics!.flatMap(previous=>{
        if(!this.requested.has(previous.retryId!))return previous;
        const candidates=offered.filter(topic=>topic.retryId===previous.retryId);
        if(previous.retryDiscovery){
          const range=previous.retrySourceRange??this.host.sourceRange;
          const owned=this.host.sourcePassages?.filter(p=>range && p.start>=range.start && p.end<=range.end)??[];
          const reviews=owned.flatMap(p=>{const rows=raw.passageReviews?.filter(r=>r.passageId===p.id)??[];return rows.length===1?rows:[];});
          this.current!.passageReviews=[...(this.current!.passageReviews??[]).filter(r=>!reviews.some(next=>next.passageId===r.passageId)),...reviews];
          if(!candidates.length && owned.length && reviews.length===owned.length && reviews.every(r=>r.status==='evidence_only'))return [];
        }
        if(previous.retryDiscovery && candidates.length){
          return candidates.map((candidate,index)=>{
            let validated=this.validate(candidate);
            const range=previous.retrySourceRange??this.host.sourceRange;
            const {spans}=resolveTopicSpans(this.content,validated);
            if(range && spans.some(span=>span.start<range.start||span.end>range.end)) validated={...validated,classificationFailed:true,confidence:0,disposition:'needs_clarification',question:'classification_retry_source_scope_invalid'};
            return {...validated,retryId:`${previous.retryId}_${index}`,...(range?{retrySourceRange:range}:{})};
          });
        }
        if(candidates.length!==1)return previous.classificationFailed?{...previous,question:`${previous.question??'classification_unavailable'}; ${candidates.length?'classification_retry_id_duplicate':'classification_retry_decision_missing'}`} : previous;
        let replacement=this.validate(candidates[0]!);
        if(previous.retrySourceRange && resolveTopicSpans(this.content,replacement).spans.some(span=>span.start<previous.retrySourceRange!.start||span.end>previous.retrySourceRange!.end)) replacement={...replacement,classificationFailed:true,confidence:0,disposition:'needs_clarification',question:'classification_retry_source_scope_invalid'};
        // Optional refinement cannot replace a source-backed uncertain decision
        // with a technically invalid response. Technical failures remain precise.
        if(replacement.classificationFailed&&!previous.classificationFailed)return previous;
        return {...replacement,...(replacement.classificationFailed?{question:`${previous.question??"classification_unavailable"}; ${replacement.question}`} : {}),retryId:previous.retryId!,...(previous.retrySourceRange?{retrySourceRange:previous.retrySourceRange}:{}),...(previous.ideaId?{ideaId:previous.ideaId}:{})};
      });
      this.current={...this.current,topics};
      // Original source coverage is retained: a corrective response cannot erase
      // review decisions belonging to accepted siblings.
    }
    return this.current!;
  }
  /** Missing discovery is a host-scoped request, not an invented atomic idea.
   * Existing accepted topics stay immutable while uncovered passages are reviewed. */
  coveragePending(passageIds:string[]){
    if(!this.current?.topics || !passageIds.length)return;
    for(const passageId of passageIds){
      const passage=this.host.sourcePassages?.find(p=>p.id===passageId);if(!passage)continue;
      const retryId='coverage_'+createHash('sha256').update(passageId).digest('hex').slice(0,24);
      if(this.current.topics.some(topic=>topic.retryId===retryId))continue;
      this.current.topics.push({topic:'Unclassified source passage',summary:'Source coverage pending',evidenceQuotes:[passage.text],pages:[],confidence:0,
        disposition:'needs_clarification',classificationFailed:true,question:'classification_assigned_passage_unsupported',retryDiscovery:true,retryId,retrySourceRange:{start:passage.start,end:passage.end},
        ...(this.host.sourceRange?{sourceRange:this.host.sourceRange}:{}),...(this.host.sourcePassages?{sourcePassages:this.host.sourcePassages}:{})});
    }
  }
  /** Catalog safety is authoritative too; persist its conservative adjustments. */
  settled(result:Classification){this.current=result;return result;}
  unavailable(error:unknown){
    const reason=error instanceof Error&&/^classify: [a-z_]+$/.test(error.message)?error.message.replace('classify: ','classification_retry_'):'classification_retry_unavailable';
    if(this.current?.topics)this.current={...this.current,topics:this.current.topics.map(topic=>topic.classificationFailed&&this.requested.has(topic.retryId!)?{...topic,question:`${topic.question??'classification_unavailable'}; ${reason}`.slice(0,1024)} : topic)};
  }
  result(){return this.current;}
  get failed(){return !!this.current?.topics?.some(topic=>topic.classificationFailed);}
}
