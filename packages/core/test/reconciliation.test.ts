import { expect, it } from 'vitest';
import { prepareReconciliation as prepareProductionReconciliation, applyReconciliation, newPageAdditions } from '../src/engine/reconciliation.js';
import { pageRevision, catalogSections } from '../src/vault/pages.js';
import { parseNote, serializeNote } from '../src/vault/frontmatter.js';
import { appendMemoryFacts, parseMemoryFacts, projectFacts, renderFactViews } from "../src/engine/temporalFacts.js";
import { hasMutationSuccessClaim } from '../src/mutationReceipt.js';
import { AnswerSupportRegistry } from '../src/engine/answerSupport.js';
import type { MemoryEntry } from '../src/types.js';
const ref = 'Log/2026-09-13.md#^e-000001';
const evidence = (content: string): MemoryEntry => ({evidenceRef:ref, path:'Log/2026-09-13.md',anchor:'e-000001',title:'source',content,source:'mcp',verbatim:true,capturedAt:'2026-09-13T10:00:00Z',url:'https://example.invalid/source',provider:'github'});
// These unit sources explicitly represent canonical classifier selections. Tests
// for missing/ambiguous candidates call the production preparer directly.
function prepareReconciliation(value:Parameters<typeof prepareProductionReconciliation>[0]) {
  return prepareProductionReconciliation({...value,addCandidates:value.sources.map(source=>({...source,ideaIds:value.ideas?value.ideas.filter(idea=>idea.sourceIds.includes(source.id)).map(idea=>idea.id):[`idea-${source.id}`]}))});
}
function selected(value:Parameters<typeof prepareProductionReconciliation>[0], choices:Array<[string,string,string[]]>) {
 const raw=value.sourceContent??value.evidence.content;
 return prepareProductionReconciliation({...value,addCandidates:choices.map(([id,text,ideaIds])=>({id,text,ideaIds,start:raw.indexOf(text),end:raw.indexOf(text)+text.length}))});
}
function input(raw: string, source: string) {
  const body = parseNote(raw).body;
  const context = {branches:[{id:'page',path:'Projects/A.md',revision:pageRevision(raw),topics:['topic'],title:'A',scope:'A',sections:catalogSections('Projects/A.md',body).map(section => ({id:section.id,revision:section.revision,start:section.start,end:section.end,excerptStart:section.start,text:body.slice(section.start,section.end),truncated:false}))}],partial:false,omitted:[],omittedCount:0,contextChars:0,estimatedTokens:0};
  return prepareReconciliation({path:'Projects/A.md',raw,title:'A',type:'project',today:'2026-09-13',evidence:evidence(source),sources:[{id:'p1',start:0,end:source.length,text:source}],context,links:['[[Index]]'],repositoryRevision:{provider:'github',id:'fixture-prior-revision',committedAt:'2026-09-12T10:00:00Z',urls:[]}});
}
const op = (kind: 'add'|'link_source'|'supersede'|'conflict'|'clarify', quote:string,targetId:string|null=null) => ({kind,sourceIds:['p1'],sourceQuote:quote,targetId,factKey:null,correctionQuote:null,reason:null});

it('canonicalizes ASR line wrapping before operation identity, fact persistence and replay', async () => {
  const source = 'Now I am correcting the bicycle workshop date that I mentioned earlier.\n The workshop will not be on November 14.\n It will be on November 21.\n This replaces the earlier date.\n It is not a second session.\n The activity and the arrangements for entering the building remain the same.\n Please preserve the previous date as history, but use the new date when answering a question about the next workshop.';
  const prepared = input('# A\nThe workshop is on November 14.\n[[Index]]\n', source);
  prepared.input.sourceContent = source;
  const split = source.indexOf('It will');
  prepared.input.sources = [{ id:'left',start:0,end:split,text:source.slice(0,split) },{ id:'right',start:split,end:source.length,text:source.slice(split) }];
  const bounded = prepareReconciliation(prepared.input);
  const folded = source.replace(/\s+/g,' ');
  const operation = {...op('supersede',folded,bounded.request.statements[0]!.id),sourceIds:['left','right'],correctionQuote:folded};
  const result = await applyReconciliation(bounded,[operation]);
  expect(result.pending).toEqual([]);
  const fact = parseMemoryFacts(parseNote(result.content).frontmatter!.memoryFacts)[0]!;
  expect(fact.statement).toBe(source); expect(fact.correctionQuote).toBe(source);
  expect(fact.legacySupersedes?.statement).toBe('The workshop is on November 14.');
  expect(operation.sourceQuote).toBe(folded); expect(prepared.input.evidence.content).toBe(source);
  const exact = await applyReconciliation(bounded,[{...operation,sourceQuote:source,correctionQuote:source}]);
  expect(exact.appliedOperationIds).toEqual(result.appliedOperationIds);
  expect(exact.content).toBe(result.content);
  const retry = prepareReconciliation({...prepared.input,raw:result.content,context:{...prepared.input.context,branches:[]}});
  const replay = await applyReconciliation(retry,[operation]);
  expect(replay.content).toBe(result.content); expect(replay.appliedOperationIds).toEqual(result.appliedOperationIds);
});

it('persists raw replacement and correction quotes rather than the folded model strings', async () => {
  const replacement='La sesión será\r\n el 19 de octubre.';
  const source=`Corrijo la fecha anterior\n del 12 de octubre. ${replacement}`;
  const prepared=input('# A\nThe session is planned for October 12.\n[[Index]]\n',source);
  const folded=source.replace(/\s+/g,' ');
  const result=await applyReconciliation(prepared,[{...op('supersede',folded,prepared.request.statements[0]!.id),replacementQuote:replacement.replace(/\s+/g,' '),correctionQuote:folded}]);
  expect(result.pending).toEqual([]);
  const fact=parseMemoryFacts(parseNote(result.content).frontmatter!.memoryFacts)[0]!;
  expect(fact.statement).toBe(replacement);expect(fact.correctionQuote).toBe(source);
});

it('rejects real ASR noncontiguous stitching, ambiguity and normalized quotes over the raw budget', async () => {
  const source='We will explain how to inspect the wheels and adjust the height of a bicycle seat.\n Visitors do not need to bring their own bicycle because the center has bicycles for the demonstration.\n The side entrance must remain clear because people also use it to reach the meeting room.\n This part concerns organization and access.\n A different intervening idea.\n The activity and the arrangements for entering the building remain the same.';
  const stitched=source.replace(' A different intervening idea.\n','').replace(/\s+/g,' ');
  for (const [raw,quote] of [[source,stitched],['Maya\n waters. Maya\t waters.','Maya waters.'],['Maya'+ '\n'.repeat(1600)+'waters.','Maya waters.']]) {
    const result=await applyReconciliation(input('# A\n[[Index]]\n',raw!),[op('conflict',quote!)]);
    expect(result.appliedOperationIds).toEqual([]);expect(result.pending.some(p=>p.reason==='source_support_invalid')).toBe(true);
  }
});
it('adds supported text to legacy Markdown preserving all old bytes and deduplicates replay', async () => {
  const raw = '# A\n\nExisting untouched prose.\n[[Index]]\n'; const text = 'The video explains logarithms.';
  const prepared = input(raw,text);
  const result = await applyReconciliation(prepared,[op('add',text)]);
  expect(result.content).toContain(raw);
  expect(result.content).toContain(text);
  expect(result.content).toContain('[[2026-09-13#^e-000001]]');
  expect(result.appliedOperationIds).toHaveLength(1);
  const replay = await applyReconciliation(input(result.content,text),[op('add',text)]);
  expect(replay.content).toBe(result.content);
});
it('links an exact existing thought without duplicate prose and rejects date/owner/negation changes', async () => {
  const raw = '# A\n\n- Alice approved launch on 2026-10-01.\n[[Index]]\n'; const text = 'Alice approved launch on 2026-10-01.';
  const prepared = input(raw,text); const target = prepared.request.statements.find(s=>s.text===text)!;
  const result = await applyReconciliation(prepared,[op('link_source',text,target.id)]);
  expect(result.content.split(text)).toHaveLength(2);
  for (const changed of ['Bob approved launch on 2026-10-01.','Alice did not approve launch on 2026-10-01.','Alice approved launch on 2026-11-01.','Alice may approve launch on 2026-10-01.']) {
    const candidate = input(raw,changed);
    const rejected = await applyReconciliation(candidate,[op('link_source',changed,target.id)]);
    expect(rejected.pending[0]?.reason).toBe('equivalence_not_established');
    expect(rejected.content).toBe(raw);
  }
});
it('rejects unsupported quotes before any other decision for the same idea', async () => {
  const text='Video explains logarithms.'; const prepared=input('# A\n[[Index]]\n',text);
  const result=await applyReconciliation(prepared,[{...op('add','Invented claim.'),sourceIds:['missing-candidate'],ideaIds:['idea-p1']},op('add',text)]);
  expect(result.content).not.toContain('Invented claim'); expect(result.content).not.toContain(text);
  expect(result.pending).toHaveLength(1); expect(result.appliedOperationIds).toHaveLength(0);
});
it('reinforces a Spanish paraphrase with one new citation and no duplicate thought', async () => {
  const raw='# A\n\nThe video explains logarithms as orders of magnitude.\n[[Index]]\n';
  const text='El vídeo explica logaritmos como órdenes de magnitud.';
  const prepared=input(raw,text);
  const result=await applyReconciliation(prepared,[op('link_source',text,prepared.request.statements[0]!.id)]);
  expect(result.pending).toEqual([]);
  expect(result.content).not.toContain(text);
  expect(result.content).toContain('The video explains logarithms as orders of magnitude. [[2026-09-13#^e-000001]]');
});

it('applies natural Spanish correction to an English current fact without reciting the old sentence', async () => {
  const old='The launch is on 12.';
  const e0={...evidence(old),evidenceRef:'Log/2026-09-13.md#^e-000002'};
  const seed=serializeNote({title:'A',type:'project',tags:[],summary:'A',created:'2026-09-12',updated:'2026-09-12'},`${old}\n[[Index]]\n`);
  const raw=appendMemoryFacts(seed,seed,[{key:'launch.date',statement:old,effectiveDate:null,effectiveDateQuote:null,correctionQuote:null,supersedesQuotes:[],verificationQuote:null}],e0);
  const source='Corrijo la fecha: ya no el 12, será el 19.';
  const prepared=input(raw,source); const target=prepared.request.statements.find(s=>s.text===old)!;
  const result=await applyReconciliation(prepared,[{...op('supersede','será el 19',target.id),statement:'El lanzamiento será el 19.',correctionQuote:source}]);
  expect(result.pending).toEqual([]); expect(result.content).toContain(old);
  const view=await projectFacts({path:'Projects/A.md'},parseNote(result.content).frontmatter!.memoryFacts,new Date('2026-09-13'),async ref=>ref===e0.evidenceRef?e0:evidence(source));
  expect(view.facts.map(f=>f.status)).toEqual(['superseded','active']);
  for (const uncertain of ['Quizás corrijo la fecha: será el 19.','If I correct the date, it could be 19.']) {
    const pending=await applyReconciliation(input(raw,uncertain),[{...op('supersede',uncertain,target.id),correctionQuote:uncertain}]);
    expect(pending.pending.length).toBeGreaterThan(0); expect(pending.content).toBe(raw);
  }
});
it('corrects legacy prose while exposing its exact prior statement and real revision separately from evidence', async () => {
  const old='The launch is on 12.'; const raw=`# A\n${old}\n[[Index]]\n`;
  const source='Correction: the launch moves to 19.'; const prepared=input(raw,source);
  const target=prepared.request.statements.find(s=>s.text===old)!;
  const result=await applyReconciliation(prepared,[{...op('supersede','the launch moves to 19',target.id),statement:'Correction: the launch moves to 19.',correctionQuote:source}]);
  expect(result.pending).toEqual([]); expect(result.content).toContain(raw);
  const view=await projectFacts({path:'Projects/A.md'},parseNote(result.content).frontmatter!.memoryFacts,new Date('2026-09-13'),async()=>evidence(source));
  expect(view.facts[0]!.status).toBe('active');
  expect(view.priorStatements).toEqual([expect.objectContaining({statement:old,revision:'fixture-prior-revision',contentHash:pageRevision(raw),supersededByEvidenceRef:ref})]);
  expect(view.warnings.join(' ')).toContain('original Log evidence');
});
it('keeps conflicting reports rather than silently correcting a current fact', async () => {
  const old='The launch is on 12.'; const raw=`# A\n${old}\n[[Index]]\n`;
  const source='Bob reports the launch is on 19.';const prepared=input(raw,source);
  const result=await applyReconciliation(prepared,[op('conflict',source,prepared.request.statements.find(s=>s.text===old)!.id)]);
  expect(result.content).toContain(old); expect(result.content).toContain('Unresolved conflict');
  expect(result.pending[0]!.reason).toBe('conflict_retained');
  expect(parseMemoryFacts(parseNote(result.content).frontmatter!.memoryFacts)[0]!.supersedes).toEqual([]);
  const view=await projectFacts({path:'Projects/A.md'},parseNote(result.content).frontmatter!.memoryFacts,new Date('2026-09-13'),async()=>evidence(source));
  expect(view.facts[0]!.status).toBe('conflict');
});
it('accounts for separate ideas sharing a source passage, even when only one operation succeeds', async () => {
  const prepared=input('# A\n[[Index]]\n','Video explains logarithms. Passport expires in May.');
  prepared.input.ideas=[{id:'video',topic:'Video',sourceIds:['p1']},{id:'travel',topic:'Travel',sourceIds:['p1']}];
  const grouped=prepareReconciliation(prepared.input);
  const result=await applyReconciliation(grouped,[{...op('add','Video explains logarithms.'),ideaIds:['video'],statement:'The video explains logarithms.'}]);
  expect(result.appliedOperations[0]!.ideaIds).toEqual(['video']);
  expect(result.pending).toContainEqual({ideaIds:['travel'],sourceIds:['p1'],reason:'reconciliation_idea_unassigned'});
});

it('keeps successive correction targets linked to the existing fact chain',async()=>{
  let raw='# A\nThe launch is on 12.\n[[Index]]\n';
  const entries=new Map<string,MemoryEntry>();
  for (const [n,value] of [[1,19],[2,20]] as const) {
    const source=`Correction: the launch moves to ${value}.`;
    const prepared=input(raw,source);
    prepared.input.evidence={...evidence(source),evidenceRef:`Log/2026-09-13.md#^e-00000${n}`};entries.set(prepared.input.evidence.evidenceRef,prepared.input.evidence);
    const target=prepared.request.statements.find(statement=>statement.text===(n===1?'The launch is on 12.':'Correction: the launch moves to 19.'))!;
    expect(target).toBeDefined();
    if(n===2) expect(target.factKey).not.toBeNull();
    const result=await applyReconciliation(prepared,[{...op('supersede',`the launch moves to ${value}`,target.id),statement:`The launch moves to ${value}.`,correctionQuote:source}]);
    expect(result.pending).toEqual([]);raw=result.content;
  }
  const view=await projectFacts({path:'Projects/A.md'},parseNote(raw).frontmatter!.memoryFacts,new Date('2026-09-13'),async ref=>entries.get(ref)!);
  expect(view.facts.map(fact=>fact.status)).toEqual(['superseded','active']);
  expect(view.priorStatements![0]!.statement).toBe('The launch is on 12.');
  const linked=input(raw,'El lanzamiento se mueve al 20.');
  linked.input.evidence={...evidence('El lanzamiento se mueve al 20.'),evidenceRef:'Log/2026-09-13.md#^e-000003'};
  const current=linked.request.statements.find(statement=>statement.text==='Correction: the launch moves to 20.')!;
  expect(current.factKey).toBe(view.facts[1]!.key);
  const reinforced=await applyReconciliation(linked,[op('link_source','El lanzamiento se mueve al 20.',current.id)]);
  expect(reinforced.pending).toEqual([]);
  expect(reinforced.content).toContain('[[2026-09-13#^e-000003]]');
  expect(reinforced.content.split('The launch moves to 20.')).toHaveLength(raw.split('The launch moves to 20.').length);
  expect(parseMemoryFacts(parseNote(reinforced.content).frontmatter!.memoryFacts)).toHaveLength(2);
});

it('keeps an idea pending when its later source associations or source text exceed the packet budget',async()=>{
  for(const size of [40,1600]) {
    const sources=Array.from({length:12},(_,i)=>({id:`s${i}`,start:24+i*size,end:24+(i+1)*size,text:(i===11?'Correction: latest decision differs.':'Early note.').padEnd(size,'x')}));
    const sibling={id:'clear',start:0,end:23,text:'Independent clear note.'};
    const prepared=input('# A\n[[Index]]\n',sibling.text+' '+sources.map(source=>source.text).join(''));
    prepared.input.sources=[sibling,...sources];
    prepared.input.ideas=[{id:'recurring',topic:'One recurring idea',sourceIds:sources.map(source=>source.id)},{id:'clear-idea',topic:'Independent idea',sourceIds:['clear']}];
    const bounded=prepareReconciliation(prepared.input);
    expect(bounded.request.ideas.map(idea=>idea.id)).toEqual(['clear-idea']);
    expect(bounded.ideas.map(idea=>idea.id)).toEqual(['recurring','clear-idea']);
    expect(bounded.omittedSourcesByIdea.get('recurring')).toContain('s11');
    const result=await applyReconciliation(bounded,[{...op('add','Early note.'),ideaIds:['recurring'],sourceIds:['s0'],statement:'Early note.'},{...op('add',sibling.text),ideaIds:['clear-idea'],sourceIds:['clear'],statement:sibling.text}]);
    expect(result.pending).toContainEqual(expect.objectContaining({ideaIds:['recurring'],sourceIds:expect.arrayContaining(['s11']),reason:'reconciliation_source_context_incomplete'}));
    expect(result.appliedOperationIds).toHaveLength(1);
    expect(result.appliedOperations[0]!.ideaIds).toEqual(['clear-idea']);
    expect(result.content).not.toContain('Early note.');
    expect(result.content).toContain(sibling.text);
  }
});

it.each([
  ['Corrijo la fecha: la sesión ya no será el 8 de septiembre; será el 15 de septiembre.', 'La sesión será el 15 de septiembre.'],
  ['Correction: the session is not on September 8 but on September 15.', 'The session is on September 15.'],
])('retains source-native wording for a full explicit contrastive correction: %s', async (source, statement) => {
  const raw = '# A\n- The session is on September 8.\n[[Index]]\n';
  const prepared = input(raw, source); const target = prepared.request.statements[0]!;
  const result = await applyReconciliation(prepared, [{...op('supersede', source, target.id),statement,correctionQuote:source}]);
  expect(result.pending).toEqual([]);
  const view = await projectFacts({path:'Projects/A.md'},parseNote(result.content).frontmatter!.memoryFacts,new Date('2026-09-13'),async()=>evidence(source));
  expect(view.facts[0]!.status).toBe('active');
  expect(view.priorStatements![0]!.statement).toBe(target.text);
  expect(result.content).toContain(source);
});
it.each([
  ['Corrección: ya no usamos 8 unidades; no usaremos 15 unidades.', 'Usaremos 15 unidades.'],
  ['Correction: no longer 8 units; we may use 15 units.', 'We use 15 units.'],
  ['Correction: not 8 units but 15 units without a deposit.', 'We use 15 units.'],
  ['Correction: not 8 units but 15 units.', 'We use 22 units.'],
])('does not weaken the replacement clause: %s',async(source,statement)=>{
  const raw='# A\n- We use 8 units.\n[[Index]]\n'; const prepared=input(raw,source);
  const result=await applyReconciliation(prepared,[{...op('supersede',source,prepared.request.statements[0]!.id),statement,correctionQuote:source}]);
  expect(result.pending).toEqual([]);expect(result.content).toContain(source);expect(result.content).not.toContain(statement);
});
it.each([
 ['El curso podría necesitar un depósito.', 'The course needs a deposit.'],
 ['La apertura está prevista para el 15.', 'The opening is on the 15.'],
 ['Sigo queriendo enseñar con mapas.', 'The course teaches with maps.'],
 ['We will not record attendees.', 'We will record attendees.'],
 ['El curso funciona sin grabaciones.', 'The course records attendees.'],
])('ignores generated weakening and retains qualified or negative source in ADD: %s',async(source,statement)=>{
 const raw='# A\n[[Index]]\n';const result=await applyReconciliation(input(raw,source),[{...op('add',source),statement}]);
 expect(result.pending).toEqual([]);expect(result.content).toContain(source);expect(result.content).not.toContain(statement);
});

it.each([
 ['We will not record the participants.', 'No grabaremos a los participantes.'],
 ['The course may require a deposit.', 'El curso podría necesitar un depósito.'],
 ['Alice approved the September 15 session.', 'Alice aprobó la sesión del 15 de septiembre.'],
])('reinforces multilingual equivalent qualifiers without adding duplicate prose: %s',async(old,source)=>{
 const raw=`# A\n- ${old}\n[[Index]]\n`;const prepared=input(raw,source);
 const result=await applyReconciliation(prepared,[op('link_source',source,prepared.request.statements[0]!.id)]);
 expect(result.pending).toEqual([]);expect(result.content).toContain(`${old} [[2026-09-13#^e-000001]]`);
 expect(result.content).not.toContain(source);
});
it('does not treat an ADD as permission to drop a denied old value from correction evidence',async()=>{
 const source='Correction: not 8 units but 15 units.';const raw='# A\n- We use 8 units.\n[[Index]]\n';
 const result=await applyReconciliation(input(raw,source),[{...op('add',source),statement:'We use 15 units.'}]);
 expect(result.pending).toEqual([]);expect(result.content).toContain(source);expect(result.content).not.toContain('We use 15 units.');
});

it('retains intention when compacting a multilingual new claim',async()=>{
 const source='Sigo queriendo enseñar con mapas.';const statement='The author wants to teach using maps.';
 const result=await applyReconciliation(input('# A\n[[Index]]\n',source),[{...op('add',source),statement}]);
 expect(result.pending).toEqual([]);expect(result.content).toContain(source);
});
it('refuses to borrow a retracted number from an unrelated target',async()=>{
 const raw='# A\n- The session date is September 8.\n- Guest capacity is 12.\n[[Index]]\n';
 const source='Correction: not 12 guests but 15 guests.';
 const prepared=input(raw,source);
 const result=await applyReconciliation(prepared,[{...op('supersede',source,prepared.request.statements[0]!.id),statement:'Guest capacity is 15.',correctionQuote:source}]);
 expect(result.content).toBe(raw);expect(result.pending[0]!.reason).toBe('correction_target_values_incompatible');
});

it('accepts the actual Spanish numeric correction when the prior date is written in words', async () => {
  const old='The workshop date is dieciséis de octubre.';
  const source='Ahora corrijo la fecha del taller de bicicletas que dije antes.\n El taller no será el 16 de octubre, será el 23 de octubre.\n Esta es una corrección de la fecha anterior, no una segunda sesión.\n El contenido de la actividad y la forma de acceso siguen siendo los mismos.\n Conviene conservar la fecha anterior como historia, pero usar la nueva cuando se pregunte por la próxima sesión.';
  const prepared=input(`# A\n${old}\n[[Index]]\n`,source);
  prepared.input.sourceContent=source;
  const target=prepared.request.statements[0]!;
  const result=await applyReconciliation(prepared,[{...op('supersede',source,target.id),correctionQuote:source}]);
  expect(result.pending).toEqual([]);
  const fact=parseMemoryFacts(parseNote(result.content).frontmatter!.memoryFacts)[0]!;
  expect(fact.statement).toBe(source);expect(fact.correctionQuote).toBe(source);
  expect(fact.legacySupersedes?.statement).toBe(old);expect(fact.legacySupersedes?.statementId).toBe(target.id);
  const view=await projectFacts({path:'Projects/A.md'},parseNote(result.content).frontmatter!.memoryFacts,new Date('2026-09-15'),async()=>evidence(source));
  expect(view.facts[0]!.status).toBe('active');expect(view.priorStatements?.[0]?.statement).toBe(old);
  expect(prepared.input.evidence.content).toBe(source);
  const unsupported=await applyReconciliation(prepared,[{...op('supersede',source.replace('23','24'),target.id),correctionQuote:source}]);
  expect(unsupported.appliedOperationIds).toEqual([]);expect(unsupported.pending.some(p=>p.reason==='source_support_invalid')).toBe(true);
});

it.each(['The workshop date is 15 de octubre.','The workshop date is 24 de octubre.'])('retains positive literal mismatch rejection: %s', async old => {
  const source='Corrijo la fecha: el taller no será el 16 de octubre, será el 23 de octubre.';
  const prepared=input(`# A\n${old}\n[[Index]]\n`,source);
  const result=await applyReconciliation(prepared,[{...op('supersede',source,prepared.request.statements[0]!.id),correctionQuote:source}]);
  expect(result.appliedOperationIds).toEqual([]);expect(result.pending[0]!.reason).toBe('correction_target_values_incompatible');
});

it('rejects all mixed decisions for one idea before writing while preserving a separate sibling', async () => {
  for (const secondKind of ['link_source','supersede'] as const) {
    const source='Capacity is 6. Correction: opening moves to 19. Tools are inspected.';
    const initial=input('# A\nCapacity is 6.\nOpening is on 12.\n[[Index]]\n',source);
    initial.input.ideas=[{id:'ambiguous',topic:'Capacity or opening',sourceIds:['p1']},{id:'tools',topic:'Tools',sourceIds:['p1']}];
    const prepared=selected(initial.input,[['capacity','Capacity is 6.',['ambiguous']],['tools','Tools are inspected.',['tools']]]);
    const target=prepared.request.statements.find(s=>s.text===(secondKind==='link_source'?'Capacity is 6.':'Opening is on 12.'))!;
    const result=await applyReconciliation(prepared,[
      {...op('add','Capacity is 6.'),sourceIds:['capacity'],ideaIds:['ambiguous']},
      {...op(secondKind,':123:456',target.id),ideaIds:['ambiguous'],statement:'Opening moves to 19.',correctionQuote:'Correction: opening moves to 19.'},
      {...op('add','Tools are inspected.'),sourceIds:['tools'],ideaIds:['tools']},
    ]);
    expect(result.appliedOperations.map(o=>o.ideaIds)).toEqual([['tools']]);
    expect(result.pending).toContainEqual(expect.objectContaining({ideaIds:['ambiguous'],reason:'source_support_invalid'}));
    expect(result.content.split('Capacity is 6.')).toHaveLength(2);
    expect(result.content).not.toContain('**Correction:**');
    expect(result.content).toContain('Tools are inspected.');
  }
});
it('uses completed idea identity across changed wording and action IDs on a partial retry',async()=>{
 const initial=input('# A\nOpening is on 12.\n[[Index]]\n','Correction: opening moves to 19. Tools are inspected.');
 initial.input.ideas=[{id:'date',topic:'Opening',sourceIds:['p1']},{id:'tools',topic:'Tools',sourceIds:['p1']}];
 const prepared=prepareReconciliation(initial.input);
 const first=await applyReconciliation(prepared,[{...op('supersede','opening moves to 19',prepared.request.statements[0]!.id),ideaIds:['date'],statement:'Opening moves to 19.',correctionQuote:'Correction: opening moves to 19.'}]);
 expect(first.pending).toHaveLength(1);
 const retrySeed=input(first.content,initial.input.evidence.content);retrySeed.input.ideas=initial.input.ideas;retrySeed.input.completedIdeaIds=['date'];
 const retry=prepareReconciliation(retrySeed.input);
 const result=await applyReconciliation(retry,[{...op('supersede','opening moves to 19',retry.request.statements.find(s=>s.text==='Correction: opening moves to 19.')!.id),ideaIds:['date'],statement:'Opening is scheduled for 19.',correctionQuote:'Correction: opening moves to 19.'},{...op('add','Tools are inspected.'),ideaIds:['tools']}]);
 expect(result.pending).toEqual([]);
 expect(result.content).not.toContain('Opening is scheduled for 19.');
 expect(parseMemoryFacts(parseNote(result.content).frontmatter!.memoryFacts)).toHaveLength(1);
});
it('rejects self-supersession from the same evidence even with a changed idea identity',async()=>{
 const prepared=input('# A\nOpening is on 12.\n[[Index]]\n','Correction: opening moves to 19.');
 const first=await applyReconciliation(prepared,[{...op('supersede','opening moves to 19',prepared.request.statements[0]!.id),statement:'Opening moves to 19.',correctionQuote:'Correction: opening moves to 19.'}]);
 const retrySeed=input(first.content,prepared.input.evidence.content);retrySeed.input.ideas=[{id:'regenerated',topic:'Opening',sourceIds:['p1']}];
 const retry=prepareReconciliation(retrySeed.input);
 const result=await applyReconciliation(retry,[{...op('supersede','opening moves to 19',retry.request.statements.find(s=>s.text==='Correction: opening moves to 19.')!.id),ideaIds:['regenerated'],statement:'Opening is scheduled for 19.',correctionQuote:'Correction: opening moves to 19.'}]);
 expect(result.content).toBe(first.content);
 expect(result.pending[0]?.reason).toBe('reconciliation_same_evidence_target');
});

it('does not append an exact same-evidence claim with regenerated operation and idea IDs',async()=>{
 const firstSeed=input('# A\n[[Index]]\n','Tools are inspected.');
 const first=await applyReconciliation(firstSeed,[op('add','Tools are inspected.')]);
 const retrySeed=input(first.content,'Tools are inspected.');retrySeed.input.ideas=[{id:'different-idea',topic:'Tools',sourceIds:['p1']}];
 const result=await applyReconciliation(prepareReconciliation(retrySeed.input),[{...op('add','Tools are inspected'),ideaIds:['different-idea'],statement:'Tools are inspected.'}]);
 expect(result.content).toBe(first.content);expect(result.pending).toEqual([]);
});
it('uses the complete source correction when replacement is elliptical, keeping history host-owned',async()=>{
 const source='Correction: opening is not on 8 but on 15.';
 const prepared=input('# A\nOpening is on 8.\n[[Index]]\n',source);
 for(const statement of [null,'Opening is on 15; the old date was 8.']) {
  const result=await applyReconciliation(prepared,[{...op('supersede','on 15',prepared.request.statements[0]!.id),statement,correctionQuote:source}]);
  expect(result.pending).toEqual([]);expect(result.content).toContain(source);expect(parseMemoryFacts(parseNote(result.content).frontmatter!.memoryFacts)[0]!.statement).toBe(source);
 }
 const good=await applyReconciliation(prepared,[{...op('supersede','on 15',prepared.request.statements[0]!.id),statement:'Opening is on 15.',correctionQuote:source}]);
 expect(good.pending).toEqual([]);
 expect(parseMemoryFacts(parseNote(good.content).frontmatter!.memoryFacts)[0]!.legacySupersedes!.statement).toBe('Opening is on 8.');
});

it.each(['add','supersede'] as const)('accepts an exact %s proposition across contiguous source chunks',async kind=>{
 const prefix='Background. '.repeat(131);
 const clause='Each visitor must receive a durable chart printed on waterproof paper before leaving.';
 const correction='Correction: '+clause;
 const content=prefix+correction;
 const seed=input('# A\nEach visitor receives a paper ticket.\n[[Index]]\n',content);
 seed.input.sourceContent=content;
 seed.input.sources=[{id:'left',start:0,end:1600,text:content.slice(0,1600)},{id:'right',start:1600,end:content.length,text:content.slice(1600)}];
 seed.input.ideas=[{id:'chart',topic:'Visitor chart',sourceIds:['left','right']}];
 const prepareSelected=(value:typeof seed.input)=>selected(value,[['chart-clause',clause,['chart']]]);
 const prepared=prepareSelected(seed.input);
 const result=await applyReconciliation(prepared,[{...op(kind,clause,kind==='supersede'?prepared.request.statements[0]!.id:null),sourceIds:kind==='add'?['chart-clause']:['left','right'],ideaIds:['chart'],statement:clause,correctionQuote:kind==='supersede'?correction:null}]);
 expect(result.pending).toEqual([]);expect(result.appliedOperationIds).toHaveLength(1);
 for(const bad of ['gap','overlap','length','bytes','unknown'] as const) {
  const changed=structuredClone(seed.input);
  if(bad==='gap') {changed.sources[1]!.start++;changed.sources[1]!.end++;}
  if(bad==='overlap') {changed.sources[1]!.start--;changed.sources[1]!.end--;}
  if(bad==='length') changed.sources[1]!.end++;
  if(bad==='bytes') changed.sources[1]!.text=changed.sources[1]!.text.replace('paper','metal');
  const rejected=await applyReconciliation(prepareSelected(changed),[{...op(kind,clause,kind==='supersede'?prepared.request.statements[0]!.id:null),sourceIds:kind==='add'?[bad==='unknown'?'missing':'chart-clause']:['left',bad==='unknown'?'missing':'right'],ideaIds:['chart'],statement:clause,correctionQuote:kind==='supersede'?correction:null}]);
  expect(rejected.content,bad).toBe(changed.raw);expect(rejected.pending.length,bad).toBeGreaterThan(0);
 }
});
it('retains independently validated effective-date support around the compact claim',async()=>{
 const claim='The policy requires helmets.';
 const content=claim+' effective 2026-10-01';
 const prepared=input('# A\n[[Index]]\n',content);
 prepared.input.facts=[{key:'policy.helmets',statement:claim,effectiveDate:'2026-10-01',effectiveDateQuote:content,correctionQuote:null,supersedesQuotes:[],verificationQuote:null}];
 const candidate=selected(prepared.input,[['claim',claim,['idea-p1']]]);
 const result=await applyReconciliation(candidate,[{...op('add',claim),sourceIds:['claim'],ideaIds:['idea-p1'],factKey:'policy.helmets'}]);
 expect(result.pending).toEqual([]);
 expect(parseMemoryFacts(parseNote(result.content).frontmatter!.memoryFacts)[0]!.effectiveDate).toBe('2026-10-01');
});
it('accepts separate correction sentences with a complete exact correction context',async()=>{
 const claim='Each visitor receives a chart.';
 const context='I correct the previous entry.\n\n'+claim;
 const prepared=input('# A\nEach visitor receives a ticket.\n[[Index]]\n',context);
 const result=await applyReconciliation(prepared,[{...op('supersede',claim,prepared.request.statements[0]!.id),statement:claim,correctionQuote:context}]);
 expect(result.pending).toEqual([]);
 expect(parseMemoryFacts(parseNote(result.content).frontmatter!.memoryFacts)[0]!.legacySupersedes!.statement).toBe('Each visitor receives a ticket.');
});

it('keeps source-native hypothesis qualification instead of judging a translated paraphrase', async()=>{
  const source='Tengo una hipótesis sin verificar: una demostración con cuerdas podría ayudar a entender las órbitas. No lo doy por probado.';
  const prepared=input('# A\n[[Index]]\n',source);
  const result=await applyReconciliation(prepared,[{...op('add',source),statement:'Unverified hypothesis: a rope demonstration could help explain orbits.'}]);
  expect(result.pending).toEqual([]);expect(result.content).toContain(source);
  expect(result.content).not.toContain('Unverified hypothesis:');
});
it('retains an untargeted attributed conflicting report without inventing current truth',async()=>{
  const source='Un colaborador afirma que el taller será el 26. No he confirmado esa afirmación y no estoy corrigiendo nuestra fecha acordada del 19.';
  const prepared=input('# A\n\nThe workshop is planned for 12.\n[[Index]]\n',source);
  const result=await applyReconciliation(prepared,[op('conflict',source)]);
  expect(result.appliedOperations).toHaveLength(1);expect(result.content).toContain(source);
  const facts=parseMemoryFacts(parseNote(result.content).frontmatter?.memoryFacts);
  expect(facts).toHaveLength(1);expect(facts[0]!.reportedConflict).toBe(true);expect(facts[0]!.supersedes).toEqual([]);
  const view=await projectFacts({path:'Projects/A.md'},parseNote(result.content).frontmatter!.memoryFacts,new Date('2026-09-14'),async()=>evidence(source));
  expect(view.facts[0]?.status).toBe('conflict');
});
it('uses exact natural correction wording instead of a generated English planned qualifier',async()=>{
  const source='Corrijo explícitamente mi fecha anterior: el primer taller ya no será el 12 de octubre; será el 19 de octubre. Guarda la fecha anterior como historia.';
  const prepared=input('# A\n\nThe first workshop is planned for October 12.\n[[Index]]\n',source);
  const target=prepared.request.statements.find(s=>s.text.includes('October 12'))!;
  const result=await applyReconciliation(prepared,[{...op('supersede',source,target.id),statement:'The first workshop is planned for October 19.',correctionQuote:source}]);
  expect(result.pending).toEqual([]);expect(result.content).toContain(source);
  const view=await projectFacts({path:'Projects/A.md'},parseNote(result.content).frontmatter!.memoryFacts,new Date('2026-09-14'),async()=>evidence(source));
  expect(view.priorStatements?.[0]?.statement).toBe(target.text);
  expect(view.facts[0]?.status).toBe('active');
});

it('selects a complete exact replacement while retaining correction context and prior provenance',async()=>{
 const replacement='La sesión será el 19 de octubre.';
 const source=`Corrijo la fecha anterior del 12 de octubre. ${replacement}`;
 const prepared=input('# A\nThe session is planned for October 12.\n[[Index]]\n',source);
 const result=await applyReconciliation(prepared,[{...op('supersede',replacement,prepared.request.statements[0]!.id),replacementQuote:replacement,correctionQuote:source}]);
 expect(result.pending).toEqual([]);
 const fact=parseMemoryFacts(parseNote(result.content).frontmatter!.memoryFacts)[0]!;
 expect(fact.statement).toBe(replacement);expect(fact.correctionQuote).toBe(source);expect(fact.legacySupersedes?.statement).toBe('The session is planned for October 12.');
});
it.each(['Correction: the session is on 19.','On 2026-09-14 I correct the date. The session is on 19.'])('does not require old-number extraction for a new-only correction: %s',async source=>{
 const prepared=input('# A\nThe session is on 12.\n[[Index]]\n',source);
 const result=await applyReconciliation(prepared,[{...op('supersede',source,prepared.request.statements[0]!.id),correctionQuote:source}]);
 expect(result.pending).toEqual([]);expect(result.content).toContain(source);
});
it('rejects an invented replacement and retains the existing explicit hypothetical correction guard',async()=>{
 for(const [source,replacement,reason] of [
  ['Correction: the launch is on 19.','The launch is on 25.','replacement_support_invalid'],
  ['I might correct the launch to 19.',null,'correction_direction_unverified'],
 ] as const){
  const raw='# A\nThe launch is on 12.\n[[Index]]\n';const prepared=input(raw,source);
  const result=await applyReconciliation(prepared,[{...op('supersede',source,prepared.request.statements[0]!.id),replacementQuote:replacement,correctionQuote:source}]);
  expect(result.content).toBe(raw);expect(result.pending[0]?.reason).toBe(reason);
 }
});
it('defers an oversized complete correction report instead of silently clipping its qualifications',async()=>{
 const source='Correction: '+ 'background context. '.repeat(90)+'The launch is on 19.';
 const raw='# A\nThe launch is on 12.\n[[Index]]\n';const prepared=input(raw,source);
 const result=await applyReconciliation(prepared,[{...op('supersede','The launch is on 19.',prepared.request.statements[0]!.id),correctionQuote:source}]);
 expect(result.content).toBe(raw);expect(result.pending[0]?.reason).toBe('complete_statement_exceeds_budget');
});
it('uses source wording rather than ignored paraphrase in operation identity and direct replay',async()=>{
 const source='Je souhaite préparer des cartes pour les visiteurs.';
 const first=await applyReconciliation(input('# A\n[[Index]]\n',source),[{...op('add',source),statement:'The visitors receive maps.'}]);
 const replay=await applyReconciliation(input(first.content,source),[{...op('add',source),statement:'A completely different ignored paraphrase.'}]);
 expect(replay.content).toBe(first.content);expect(replay.appliedOperationIds).toEqual(first.appliedOperationIds);
 expect(parseNote(first.content).body).toContain(source);expect(first.content).not.toContain('The visitors receive maps.');
});
it.each(['add','conflict','supersede'] as const)('round-trips an exact %s statement beyond the historical display cap',async kind=>{
 const source=(kind==='supersede'?'Correction: the session is on 19. ':kind==='conflict'?'A colleague reports another date, but it is unconfirmed. ':'The session includes a demonstration. ')+ 'The supporting explanation is retained in its original wording. '.repeat(15);
 expect(source.length).toBeGreaterThan(800);expect(source.length).toBeLessThanOrEqual(1600);
 const prepared=input('# A\nThe session is on 12.\n[[Index]]\n',source);
 const result=await applyReconciliation(prepared,[{...op(kind,source,kind==='supersede'?prepared.request.statements[0]!.id:null),factKey:kind==='add'?'session.details':null,correctionQuote:kind==='supersede'?source:null}]);
 expect(result.appliedOperations).toHaveLength(1);
 const facts=parseMemoryFacts(parseNote(result.content).frontmatter!.memoryFacts);
 expect(facts).toHaveLength(1);expect(facts[0]!.statement).toBe(source);expect(facts[0]!.renderedStatement).toBeUndefined();
 const view=await projectFacts({path:'Projects/A.md'},facts,new Date('2026-09-14'),async()=>evidence(source));
 expect(view.facts[0]?.status).toBe(kind==='conflict'?'conflict':'active');
});
it('retains correction and complete conflicting report across related idea descriptors without linking to a changed target',async()=>{
 const correction='Correction: the session moves from 8 to 15.';
 const report='A colleague suggests 22. That is unconfirmed; our agreed date remains 15.';
 const source=correction+'\n\n'+report;
 const base=input('# A\nThe session is on 8.\n[[Index]]\n',source);
 const prepared=prepareReconciliation({...base.input,ideas:[{id:'change',topic:'Corrected date',sourceIds:['p1']},{id:'report',topic:'Unconfirmed alternative',sourceIds:['p1']},{id:'retained',topic:'Agreed date retained',sourceIds:['p1']}]});
 const target=prepared.request.statements.find(s=>s.text==='The session is on 8.')!.id;
 const result=await applyReconciliation(prepared,[{...op('supersede',correction,target),ideaIds:['change'],correctionQuote:correction},{...op('conflict',report,target),ideaIds:['report','retained']}]);
 expect(result.appliedOperations).toHaveLength(2);
 expect(result.appliedOperations.flatMap(item=>item.ideaIds).sort()).toEqual(['change','report','retained']);
 expect(result.pending).toEqual([expect.objectContaining({reason:'conflict_retained',ideaIds:['report','retained']})]);
 const facts=parseMemoryFacts(parseNote(result.content).frontmatter!.memoryFacts);
 expect(facts).toHaveLength(2);expect(facts[0]!.legacySupersedes?.statement).toBe('The session is on 8.');
 expect(facts[1]!.reportedConflict).toBe(true);expect(facts[1]!.statement).toBe(report);expect(facts[1]!.key).toBe(facts[0]!.key);
 const rejected=await applyReconciliation(prepared,[{...op('link_source','our agreed date remains 15.',target),ideaIds:['retained']}]);
 expect(rejected.appliedOperations).toEqual([]);expect(rejected.pending.some(item=>item.reason==='equivalence_not_established')).toBe(true);
});

it.each([
 'Correction: the session will no longer be on 12 October; it will be on 19 October.',
 'Corrijo la fecha: la sesión ya no será el 12 de octubre; será el 19 de octubre.',
])('retains complete correction report and previous history with null replacement: %s',async source=>{
 const prepared=input('# A\nThe session is on 12 October.\n[[Index]]\n',source);
 const target=prepared.request.statements[0]!;
 const result=await applyReconciliation(prepared,[{...op('supersede',source,target.id),replacementQuote:null,correctionQuote:source}]);
 expect(result.pending).toEqual([]);
 const fact=parseMemoryFacts(parseNote(result.content).frontmatter!.memoryFacts)[0]!;
 expect(fact.statement).toBe(source);expect(fact.correctionQuote).toBe(source);expect(fact.legacySupersedes?.statement).toBe(target.text);
 const replay=await applyReconciliation(input(result.content,source),[{...op('supersede',source,target.id),replacementQuote:null,correctionQuote:source}]);
 expect(replay.content).toBe(result.content);
});

it.each([
 ['Correction: the session will no longer be on 12 October; it will be on 19 October.', 'A colleague reports 26 October. This is unconfirmed and does not change our agreed 19 October.'],
 ['Corrijo la fecha: la sesión ya no será el 12 de octubre; será el 19 de octubre.', 'Un colaborador afirma que será el 26 de octubre. No he confirmado esa afirmación y no estoy corrigiendo nuestra fecha acordada del 19.'],
])('distinguishes applied correction provenance from retained conflict without declaring a winner: %s',async(correction,report)=>{
 const source=correction+'\n\n'+report, raw='# A\nThe session is on 12 October.\n[[Index]]\n';
 const base=input(raw,source);
 const prepared=prepareReconciliation({...base.input,ideas:[{id:'change',topic:'Changed date',sourceIds:['p1']},{id:'report',topic:'Reported alternative',sourceIds:['p1']}]});
 const target=prepared.request.statements[0]!.id;
 const result=await applyReconciliation(prepared,[{...op('supersede',correction,target),ideaIds:['change'],replacementQuote:null,correctionQuote:correction},{...op('conflict',report,target),ideaIds:['report']}]);
 const metadata=parseMemoryFacts(parseNote(result.content).frontmatter!.memoryFacts);
 const view=await projectFacts({path:'Projects/A.md'},metadata,new Date('2026-09-14'),async()=>evidence(source));
 expect(view.facts.map(f=>f.status)).toEqual(['conflict','conflict']);
 const rendered=renderFactViews([view]);
 expect(rendered).toContain('Recorded correction report');expect(rendered).toContain('Conflicting report (not applied as a correction)');
 expect(hasMutationSuccessClaim(rendered)).toBe(false);
 expect(rendered).toContain(correction);expect(rendered).toContain(report);expect(rendered).toContain('Prior note statement (superseded');
 const registry=new AnswerSupportRegistry();const hints=registry.addFacts(view);
 expect(hints.filter(h=>h.kind==='fact').map(h=>h.modes)).toEqual([['conflict'],['conflict']]);
 const selected=registry.render(hints.map(h=>({id:h.id,mode:h.modes[0]!})));
 expect(selected.valid).toBe(true);expect(selected.text).toContain('Recorded correction report');expect(selected.text).toContain(report);
 const past=await projectFacts({path:'Projects/A.md',asOf:'2026-09-01'},metadata,new Date('2026-09-14'),async()=>evidence(source));
 expect(past.facts.map(f=>f.status)).toEqual(['undated','undated']);expect(renderFactViews([past])).toContain('Effective date unknown');
 const missing=await projectFacts({path:'Projects/A.md'},metadata,new Date('2026-09-14'),async()=>{throw Error('unavailable')});
 expect(renderFactViews([missing])).not.toContain('Recorded correction report');
});


it('preserves a new condition alongside reinforcement in one coarse idea',async()=>{
 const source='Mina checks on Tuesday. If it rains, Mina checks the drain before watering.';
 const seed=input('# A\nMina checks on Tuesday.\n[[Index]]\n',source);
 const prepared=selected(seed.input,[['condition','If it rains, Mina checks the drain before watering.',['idea-p1']]]);
 const result=await applyReconciliation(prepared,[op('link_source','Mina checks on Tuesday.',prepared.request.statements[0]!.id),{...op('add','ignored'),sourceIds:['condition'],ideaIds:['idea-p1']}]);
 expect(result.pending).toEqual([]);expect(result.appliedOperationIds).toHaveLength(2);
 expect(result.content).toContain('Mina checks on Tuesday. [[2026-09-13#^e-000001]]');
 expect(result.content).toContain('If it rains, Mina checks the drain before watering.');
 const replay=await applyReconciliation(selected(input(result.content,source).input,[['condition','If it rains, Mina checks the drain before watering.',['idea-p1']]]),[op('link_source','Mina checks on Tuesday.',prepared.request.statements[0]!.id),{...op('add','ignored'),sourceIds:['condition'],ideaIds:['idea-p1']}]);
 expect(replay.content).toBe(result.content);
});
it.each([false,true])('rolls back valid plus invalid group regardless of order (%s)',async reverse=>{
 const source='New procedure applies. Existing schedule holds.';
 const prepared=input('# A\nExisting schedule holds.\n[[Index]]\n',source);
 const decisions=[op('add','New procedure applies.'),op('link_source','Invented source.',prepared.request.statements[0]!.id)];
 const result=await applyReconciliation(prepared,reverse?decisions.reverse():decisions);
 expect(result.content).toBe(prepared.input.raw);expect(result.appliedOperations).toEqual([]);
 expect(result.pending[0]!.reason).toBe('source_support_invalid');
});
it('rolls back transitive shared ideas including clarification, preserving independent groups',async()=>{
 const source='First procedure. Second procedure. Third procedure. Healthy procedure.';
 const seed=input('# A\n[[Index]]\n',source);seed.input.ideas=['A','B','C','D'].map(id=>({id,topic:id,sourceIds:['p1']}));
 const prepared=selected(seed.input,[['first','First procedure.',['A']],['second','Second procedure.',['A','B']],['healthy','Healthy procedure.',['D']]]);
 const result=await applyReconciliation(prepared,[{...op('add','First procedure.'),sourceIds:['first'],ideaIds:['A']},{...op('add','Second procedure.'),sourceIds:['second'],ideaIds:['A','B']},{...op('clarify','Third procedure.'),ideaIds:['B','C']},{...op('add','Healthy procedure.'),sourceIds:['healthy'],ideaIds:['D']}]);
 expect(result.content).not.toContain('First procedure.');expect(result.content).not.toContain('Second procedure.');expect(result.content).toContain('Healthy procedure.');
 expect(result.appliedOperations.map(operation=>operation.ideaIds)).toEqual([['D']]);
 expect(result.pending.flatMap(item=>item.ideaIds).sort()).toEqual(['A','B','C']);
});
it('allows overlapping complete qualification contexts for separate claims',async()=>{
 const source='Only if approved: Mina checks the drain. Only if approved: Mina checks the drain. Omar records the result.';
 const prepared=selected(input('# A\n[[Index]]\n',source).input,[['first','Only if approved: Mina checks the drain.',['idea-p1']],['second','Only if approved: Mina checks the drain. Omar records the result.',['idea-p1']]]);
 const result=await applyReconciliation(prepared,[{...op('add','ignored'),sourceIds:['first'],ideaIds:['idea-p1']},{...op('add','ignored'),sourceIds:['second'],ideaIds:['idea-p1']}]);
 expect(result.pending).toEqual([]);expect(result.appliedOperations).toHaveLength(2);
 expect(result.content).toContain('Only if approved: Mina checks the drain. Omar records the result.');
});
it('rejects incompatible corrections of one original target even across distinct ideas',async()=>{
 const source='Correction: launch is now on 19. Correction: launch is now on 26.';
 const seed=input('# A\nLaunch is on 12.\n[[Index]]\n',source);seed.input.ideas=['A','B'].map(id=>({id,topic:id,sourceIds:['p1']}));
 const prepared=prepareReconciliation(seed.input),target=prepared.request.statements[0]!.id;
 const result=await applyReconciliation(prepared,['Correction: launch is now on 19.','Correction: launch is now on 26.'].map((quote,i)=>({...op('supersede',quote,target),ideaIds:[i?'B':'A'],correctionQuote:quote})));
 expect(result.content).toBe(seed.input.raw);expect(result.appliedOperations).toEqual([]);
 expect(result.pending.every(item=>item.reason.includes('reconciliation_incompatible_decisions'))).toBe(true);
});

it('deduplicates the same source-native effect while completing distinct ideas',async()=>{
 const source='A new procedure applies.'; const seed=input('# A\n[[Index]]\n',source);
 seed.input.ideas=['A','B'].map(id=>({id,topic:id,sourceIds:['p1']}));
 const prepared=prepareReconciliation(seed.input);
 const result=await applyReconciliation(prepared,['A','B'].map(id=>({...op('add',source),ideaIds:[id]})));
 expect(result.pending).toEqual([]);expect(result.appliedOperations.flatMap(o=>o.ideaIds)).toEqual(['A','B']);
 expect(parseNote(result.content).body.split(source)).toHaveLength(2);
});
it('rejects distinct supported replacements hidden behind the same correction quote',async()=>{
 const source='Correction: launch is on 19. Correction: launch is on 26.';
 const prepared=input('# A\nLaunch is on 12.\n[[Index]]\n',source),target=prepared.request.statements[0]!.id;
 const result=await applyReconciliation(prepared,['launch is on 19.','launch is on 26.'].map(replacementQuote=>({...op('supersede',source,target),correctionQuote:source,replacementQuote})));
 expect(result.content).toBe(prepared.input.raw);expect(result.appliedOperations).toEqual([]);
 expect(result.pending[0]!.reason).toContain('reconciliation_incompatible_decisions');
});
it('completes an unfinished facet of a shared operation without reopening completed ideas',async()=>{
 const source='A complete new condition.';const seed=input('# A\n[[Index]]\n',source);
 seed.input.ideas=['A','B'].map(id=>({id,topic:id,sourceIds:['p1']}));seed.input.completedIdeaIds=['A'];
 const result=await applyReconciliation(prepareReconciliation(seed.input),[{...op('add',source),ideaIds:['A','B']}]);
 expect(result.pending).toEqual([]);expect(result.appliedOperations[0]!.ideaIds).toEqual(['B']);
 expect(result.content).toContain(source);
});

it('keeps completed facets unchanged when an unfinished shared group fails',async()=>{
 const source='Existing condition. New condition.';const seed=input('# A\nExisting condition.\n[[Index]]\n',source);
 seed.input.ideas=['A','B'].map(id=>({id,topic:id,sourceIds:['p1']}));seed.input.completedIdeaIds=['A'];
 const prepared=prepareReconciliation(seed.input);
 const failed=await applyReconciliation(prepared,[{...op('add','New condition.'),ideaIds:['A','B']},{...op('add','Invented.'),sourceIds:['missing'],ideaIds:['B']}]);
 expect(failed.content).toBe(seed.input.raw);expect(failed.pending.flatMap(p=>p.ideaIds)).toEqual(['B']);
 const valid=await applyReconciliation(prepared,[{...op('add','Invented.'),ideaIds:['A']},{...op('add','New condition.'),ideaIds:['A','B']}]);
 expect(valid.pending).toEqual([]);expect(valid.appliedOperations[0]!.ideaIds).toEqual(['B']);
});

it('applies host ADDs directly for a page that does not exist yet instead of asking the reconciler', async () => {
  const raw = 'The observatory opens on 8 September and runs a night session.';
  const prepared = prepareProductionReconciliation({
    path: 'Notes/Observatory.md', raw: null, title: 'Observatory', type: 'note', today: '2026-09-18',
    evidence: evidence(raw), sources: [{ id: 'p1', start: 0, end: raw.length, text: raw }],
    context: { branches: [], partial: true, omitted: [], omittedCount: 0, discoveryGaps: 0, contextChars: 0, estimatedTokens: 0 },
    links: [], addCandidates: [{ id: 'p1', start: 0, end: raw.length, text: raw, ideaIds: ['idea-1'] }],
    ideas: [{ id: 'idea-1', topic: 'Observatory opening', sourceIds: ['p1'] }],
  });
  expect(prepared.request.statements).toEqual([]);
  expect(prepared.request.branch).toBeUndefined();
  const operations = newPageAdditions(prepared);
  expect(operations).toHaveLength(1);
  expect(operations[0]).toMatchObject({ kind: 'add', ideaIds: ['idea-1'], sourceIds: ['p1'], targetId: null });
  const result = await applyReconciliation(prepared, operations);
  expect(result.pending).toEqual([]);
  expect(result.content).toContain(raw);
  expect(result.content).toContain('[[2026-09-13#^e-000001]]');
});

it('leaves a new-page idea without a host candidate pending rather than clarifying it', async () => {
  const raw = 'The observatory opens on 8 September.';
  const prepared = prepareProductionReconciliation({
    path: 'Notes/Observatory.md', raw: null, title: 'Observatory', type: 'note', today: '2026-09-18',
    evidence: evidence(raw), sources: [{ id: 'p1', start: 0, end: raw.length, text: raw }],
    context: { branches: [], partial: true, omitted: [], omittedCount: 0, discoveryGaps: 0, contextChars: 0, estimatedTokens: 0 },
    links: [], addCandidates: [], ideas: [{ id: 'idea-1', topic: 'Observatory opening', sourceIds: ['p1'] }],
  });
  const result = await applyReconciliation(prepared, newPageAdditions(prepared));
  expect(result.content).toBe('');
  expect(result.pending.map(item => item.reason)).toEqual(['reconciliation_idea_unassigned']);
});
