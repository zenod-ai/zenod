import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendEvidence,getEvidenceEntry} from '../src/engine/evidence.js';
import {filingInputFingerprint,filingReceiptPath,sealFilingReceipt,renderFilingReceipt,parseFilingReceipt} from '../src/engine/filingReceipt.js';
import {pendingTopicDiscovery} from '../src/ops/pendingDiscovery.js';
import {searchVault} from '../src/ops/search.js';
let root:string;const content='La lectura es provisional. No se ha decidido el libro.';let ref:string,path:string,receipt:any,input:any;
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),'pending-discovery-'));await mkdir(join(root,'Inbox'));
 const entry=await appendEvidence(root,content,'selftest',true,new Date('2026-09-14T12:00:00Z'));ref=`${entry.logPath}#^${entry.anchor}`;path=filingReceiptPath(ref);input={evidenceRef:ref,content,source:'selftest'};
 receipt={version:1,evidenceRef:ref,inputFingerprint:filingInputFingerprint(input),phase:'ready',baseRevision:{provider:'github',id:'test',urls:[]},files:{},classification:{topics:[{ideaId:'idea1',topic:'Library reading proposal remains undecided',evidenceQuotes:[content],evidenceAssignments:[],pages:[],confidence:.8,disposition:'needs_clarification',summary:'CONTROL_SECRET'}]},outcomes:[{ideaId:'idea1',topic:'not searched',evidenceRef:ref,status:'uncertain',sourceSpans:[{start:0,end:content.length}]}]};
 await save();
});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
async function save(){await writeFile(join(root,path),renderFilingReceipt(sealFilingReceipt(receipt)));}
const discover=()=>pendingTopicDiscovery(root,[path],s=>s.includes('Library'));
it('exposes only a pending label and exact raw ref across languages; raw must still be read',async()=>{
 expect(await discover()).toEqual([{ref,label:receipt.classification.topics[0].topic}]);
 const hits=await searchVault(root,'library reading');expect(hits).toHaveLength(1);expect(hits[0]!.path).toBe(ref);expect(hits[0]!.snippet).toContain('Pending topic discovery');expect(hits[0]).not.toHaveProperty('answerSupports');
 expect((await getEvidenceEntry(root,hits[0]!.path)).content).toBe(content);
 expect(await searchVault(root,'CONTROL_SECRET')).toEqual([]);
 expect(await searchVault(root,'lectura')).not.toEqual([]);
});
it('keeps replay fingerprint validation strict after shared parser extraction',async()=>{
 const text=await readFile(join(root,path),'utf8');expect(parseFilingReceipt(text,input)).not.toBeNull();expect(parseFilingReceipt(text,{...input,hints:['different']})).toBeNull();
});
it.each(['malformed','hash','missing','stale','external','wrong-anchor','wrong-identity','out-of-bounds','unknown-idea','duplicate-idea','filed','prepared','oversized-topic','null-outcome','null-span','malformed-assignment'])('skips %s sources or receipts',async mode=>{
 if(mode==='malformed'){await writeFile(join(root,path),'```json\n{}\n```');expect(await discover()).toEqual([]);return;}
 if(mode==='hash'){await writeFile(join(root,path),(await readFile(join(root,path),'utf8')).replace('Library','Other'));expect(await discover()).toEqual([]);return;}
 if(mode==='missing')await rm(join(root,ref.split('#')[0]!));
 if(mode==='stale')await writeFile(join(root,ref.split('#')[0]!),(await readFile(join(root,ref.split('#')[0]!),'utf8')).replaceAll('La lectura','La comida'));
 if(mode==='external')receipt.evidenceRef='https://example.com/private';
 if(mode==='wrong-anchor')receipt.evidenceRef=ref+'other';
 if(mode==='wrong-identity')receipt.outcomes[0].evidenceRef=ref+'other';
 if(mode==='out-of-bounds')receipt.outcomes[0].sourceSpans[0].end=content.length+1;
 if(mode==='unknown-idea')receipt.outcomes[0].ideaId='unknown';
 if(mode==='duplicate-idea')receipt.classification.topics.push({...receipt.classification.topics[0]});
 if(mode==='null-outcome'){receipt.outcomes=[null];await writeFile(join(root,path),'\n```json\n'+JSON.stringify(sealFilingReceipt(receipt))+'\n```\n');expect(await discover()).toEqual([]);return;}
 if(mode==='null-span')receipt.outcomes[0].sourceSpans=[null];
 if(mode==='malformed-assignment')receipt.classification.topics[0].evidenceAssignments=[null];
 if(mode==='filed')receipt.outcomes[0].status='filed';
 if(mode==='prepared')receipt.phase='prepared';
 if(mode==='oversized-topic')receipt.classification.topics[0].topic+='x'.repeat(401);
 await save();expect(await discover()).toEqual([]);
});
it('bounds topic count and raw bytes and cannot escape to another tenant through symlinks',async()=>{
 const other=await mkdtemp(join(tmpdir(),'other-tenant-'));
 try{
  const log=ref.split('#')[0]!;await mkdir(join(other,'Log'));await writeFile(join(other,log),await readFile(join(root,log)));
  await rm(join(root,log));await symlink(join(other,log),join(root,log));expect(await discover()).toEqual([]);
  await rm(join(root,log));await writeFile(join(root,log),'x'.repeat(512001));expect(await discover()).toEqual([]);
  receipt.classification.topics=Array.from({length:25},(_,i)=>({...receipt.classification.topics[0],ideaId:`idea${i}`}));await save();expect(await discover()).toEqual([]);
 }finally{await rm(other,{recursive:true,force:true});}
});
