import { open, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { filingReceiptPath, parseFilingReceiptEnvelope } from "../engine/filingReceipt.js";
import { evidenceEntryFromText } from "../engine/evidence.js";
import { resolveRawSourceQuote } from "../engine/sourceQuote.js";
import { isFilingReceiptPath } from "../vault/files.js";

const MAX_RECEIPTS = 32, MAX_BYTES = 512_000, MAX_TOTAL_BYTES = 2_000_000, MAX_TOPICS = 24, MAX_RAW_READS = 8;
/** Labels are discovery hints only, never claim evidence or answer support. */
export async function pendingTopicDiscovery(vaultPath: string, files: string[], matches: (label: string) => boolean): Promise<Array<{ref:string;label:string}>> {
  const root = await realpath(vaultPath);
  let remaining = MAX_TOTAL_BYTES, rawReads = 0;
  async function boundedFile(path:string):Promise<string|null> {
    try {
      const target = await realpath(join(root,path)), rel = relative(root,target);
      if(isAbsolute(rel)||rel.startsWith("../")||rel===".."||rel.split("/").some(p=>p.startsWith(".")))return null;
      const file=await open(target,"r");
      try {
        const stat=await file.stat();if(!stat.isFile()||stat.size>MAX_BYTES||stat.size>remaining)return null;
        remaining-=stat.size;
        const buffer=Buffer.alloc(stat.size+1);const {bytesRead}=await file.read(buffer,0,buffer.length,0);
        if(bytesRead!==stat.size)return null;
        return buffer.subarray(0,bytesRead).toString("utf8");
      } finally {await file.close();}
    } catch {return null;}
  }
  const results:Array<{ref:string;label:string}>=[];
  for(const path of files.filter(isFilingReceiptPath).sort().reverse().slice(0,MAX_RECEIPTS)) {
    const raw=await boundedFile(path);if(raw===null)continue;
    const receipt=parseFilingReceiptEnvelope(raw);
    if(!receipt||receipt.phase!=="ready"||receipt.classification.topics.length>MAX_TOPICS||receipt.outcomes.length>MAX_TOPICS||receipt.outcomes.some(item=>!item||typeof item!=="object"))continue;
    try {if(filingReceiptPath(receipt.evidenceRef)!==path)continue;}catch{continue;}
    const candidates=receipt.outcomes.filter(outcome=>{
      const topics=receipt.classification.topics.filter(topic=>topic.ideaId===outcome.ideaId);
      return (outcome.status==="pending"||outcome.status==="uncertain")&&outcome.evidenceRef===receipt.evidenceRef
        &&topics.length===1&&typeof topics[0]!.topic==="string"&&topics[0]!.topic.length<=400&&matches(topics[0]!.topic);
    });
    if(!candidates.length||rawReads>=MAX_RAW_READS)continue;
    rawReads++;
    const logPath=receipt.evidenceRef.split("#^")[0]!;
    const log=await boundedFile(logPath);if(log===null)continue;
    let entry;try {entry=evidenceEntryFromText(receipt.evidenceRef,log);}catch{continue;}
    if(entry.evidenceRef!==receipt.evidenceRef||entry.content.length>MAX_BYTES)continue;
    for(const outcome of candidates) {
      const topic=receipt.classification.topics.find(topic=>topic.ideaId===outcome.ideaId)!;
      const spans=outcome.sourceSpans;
      if(!Array.isArray(spans)||!spans.length||spans.length>24||spans.some(span=>!span||!Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||span.start<0||span.end<=span.start||span.end>entry.content.length))continue;
      if(topic.evidenceAssignments!==undefined && (!Array.isArray(topic.evidenceAssignments)||topic.evidenceAssignments.some(item=>!item||typeof item.quote!=="string")))continue;
      const quotes=topic.evidenceAssignments?.length?topic.evidenceAssignments.map(item=>item.quote):topic.evidenceQuotes;
      if(!Array.isArray(quotes)||!quotes.length||quotes.length>24||quotes.some(quote=>typeof quote!=="string"||!quote.trim()||quote.length>2400||!resolveRawSourceQuote(spans.map(span=>({start:span.start,text:entry.content.slice(span.start,span.end)})),quote,{maxRawChars:2400})))continue;
      results.push({ref:receipt.evidenceRef,label:topic.topic});
      if(results.length>=MAX_TOPICS)return results;
    }
  }
  return results;
}
