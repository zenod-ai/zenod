import { expect, it } from 'vitest';
import { prepareReconciliation, applyReconciliation } from '../src/engine/reconciliation.js';
import { pageRevision, catalogSections } from '../src/vault/pages.js';
import { parseNote, serializeNote } from '../src/vault/frontmatter.js';
import { appendMemoryFacts, parseMemoryFacts, projectFacts } from "../src/engine/temporalFacts.js";
import type { MemoryEntry } from '../src/types.js';
const ref = 'Log/2026-09-13.md#^e-000001';
const evidence = (content: string): MemoryEntry => ({evidenceRef:ref, path:'Log/2026-09-13.md',anchor:'e-000001',title:'source',content,source:'mcp',verbatim:true,capturedAt:'2026-09-13T10:00:00Z',url:'https://example.invalid/source',provider:'github'});
function input(raw: string, source: string) {
  const body = parseNote(raw).body;
  const context = {branches:[{id:'page',path:'Projects/A.md',revision:pageRevision(raw),topics:['topic'],title:'A',scope:'A',sections:catalogSections('Projects/A.md',body).map(section => ({id:section.id,revision:section.revision,start:section.start,end:section.end,excerptStart:section.start,text:body.slice(section.start,section.end),truncated:false}))}],partial:false,omitted:[],omittedCount:0,contextChars:0,estimatedTokens:0};
  return prepareReconciliation({path:'Projects/A.md',raw,title:'A',type:'project',today:'2026-09-13',evidence:evidence(source),sources:[{id:'p1',start:0,end:source.length,text:source}],context,links:['[[Index]]'],repositoryRevision:{provider:'github',id:'fixture-prior-revision',committedAt:'2026-09-12T10:00:00Z',urls:[]}});
}
const op = (kind: 'add'|'link_source'|'supersede'|'conflict'|'clarify', quote:string,targetId:string|null=null) => ({kind,sourceIds:['p1'],sourceQuote:quote,targetId,factKey:null,correctionQuote:null,reason:null});
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
  const result=await applyReconciliation(prepared,[op('add','Invented claim.'),op('add',text)]);
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
  const result=await applyReconciliation(prepared,[{...op('supersede','the launch moves to 19',target.id),statement:'The launch moves to 19.',correctionQuote:source}]);
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
    const target=prepared.request.statements.find(statement=>statement.text===(n===1?'The launch is on 12.':'The launch moves to 19.'))!;
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
  const current=linked.request.statements.find(statement=>statement.text==='The launch moves to 20.')!;
  expect(current.factKey).toBe(view.facts[1]!.key);
  const reinforced=await applyReconciliation(linked,[op('link_source','El lanzamiento se mueve al 20.',current.id)]);
  expect(reinforced.pending).toEqual([]);
  expect(reinforced.content).toContain('[[2026-09-13#^e-000003]]');
  expect(reinforced.content.split('The launch moves to 20.')).toHaveLength(raw.split('The launch moves to 20.').length);
  expect(parseMemoryFacts(parseNote(reinforced.content).frontmatter!.memoryFacts)).toHaveLength(2);
});

it('keeps an idea pending when its later source associations or source text exceed the packet budget',async()=>{
  for(const size of [30,1600]) {
    const sources=Array.from({length:12},(_,i)=>({id:`s${i}`,start:i*size,end:(i+1)*size,text:(i===11?'Correction: latest decision differs.':'Early note.').padEnd(size,'x')}));
    const prepared=input('# A\n[[Index]]\n',sources.map(source=>source.text).join(''));
    const sibling={id:'clear',start:0,end:23,text:'Independent clear note.'};
    prepared.input.sources=[sibling,...sources];
    prepared.input.ideas=[{id:'recurring',topic:'One recurring idea',sourceIds:sources.map(source=>source.id)},{id:'clear-idea',topic:'Independent idea',sourceIds:['clear']}];
    const bounded=prepareReconciliation(prepared.input);
    expect(bounded.request.ideas[0]).toMatchObject({sourcePartial:true});
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
])('accepts a compact new claim from a full explicit contrastive correction: %s', async (source, statement) => {
  const raw = '# A\n- The session is on September 8.\n[[Index]]\n';
  const prepared = input(raw, source); const target = prepared.request.statements[0]!;
  const result = await applyReconciliation(prepared, [{...op('supersede', source, target.id),statement,correctionQuote:source}]);
  expect(result.pending).toEqual([]);
  const view = await projectFacts({path:'Projects/A.md'},parseNote(result.content).frontmatter!.memoryFacts,new Date('2026-09-13'),async()=>evidence(source));
  expect(view.facts[0]!.status).toBe('active');
  expect(view.priorStatements![0]!.statement).toBe(target.text);
  expect(result.content).toContain(statement);
});
it.each([
  ['Corrección: ya no usamos 8 unidades; no usaremos 15 unidades.', 'Usaremos 15 unidades.'],
  ['Correction: no longer 8 units; we may use 15 units.', 'We use 15 units.'],
  ['Correction: not 8 units but 15 units without a deposit.', 'We use 15 units.'],
  ['Correction: not 8 units but 15 units.', 'We use 22 units.'],
])('does not weaken the replacement clause: %s',async(source,statement)=>{
  const raw='# A\n- We use 8 units.\n[[Index]]\n'; const prepared=input(raw,source);
  const result=await applyReconciliation(prepared,[{...op('supersede',source,prepared.request.statements[0]!.id),statement,correctionQuote:source}]);
  expect(result.content).toBe(raw); expect(result.pending.length).toBeGreaterThan(0);
});
it.each([
 ['El curso podría necesitar un depósito.', 'The course needs a deposit.'],
 ['La apertura está prevista para el 15.', 'The opening is on the 15.'],
 ['Sigo queriendo enseñar con mapas.', 'The course teaches with maps.'],
 ['We will not record attendees.', 'We will record attendees.'],
 ['El curso funciona sin grabaciones.', 'The course records attendees.'],
])('rejects qualified or negative source weakening in ADD: %s',async(source,statement)=>{
 const raw='# A\n[[Index]]\n';const result=await applyReconciliation(input(raw,source),[{...op('add',source),statement}]);
 expect(result.content).toBe(raw);expect(result.pending[0]!.reason).toBe('statement_qualifiers_changed');
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
 expect(result.content).toBe(raw);expect(result.pending[0]!.reason).toBe('statement_qualifiers_changed');
});

it('retains intention when compacting a multilingual new claim',async()=>{
 const source='Sigo queriendo enseñar con mapas.';const statement='The author wants to teach using maps.';
 const result=await applyReconciliation(input('# A\n[[Index]]\n',source),[{...op('add',source),statement}]);
 expect(result.pending).toEqual([]);expect(result.content).toContain(statement);
});
it('refuses to borrow a retracted number from an unrelated target',async()=>{
 const raw='# A\n- The session date is September 8.\n- Guest capacity is 12.\n[[Index]]\n';
 const source='Correction: not 12 guests but 15 guests.';
 const prepared=input(raw,source);
 const result=await applyReconciliation(prepared,[{...op('supersede',source,prepared.request.statements[0]!.id),statement:'Guest capacity is 15.',correctionQuote:source}]);
 expect(result.content).toBe(raw);expect(result.pending[0]!.reason).toBe('statement_qualifiers_changed');
});

it('rejects all mixed decisions for one idea before writing while preserving a separate sibling', async () => {
  for (const secondKind of ['link_source','supersede'] as const) {
    const source='Capacity is 6. Correction: opening moves to 19. Tools are inspected.';
    const initial=input('# A\nCapacity is 6.\nOpening is on 12.\n[[Index]]\n',source);
    initial.input.ideas=[{id:'ambiguous',topic:'Capacity or opening',sourceIds:['p1']},{id:'tools',topic:'Tools',sourceIds:['p1']}];
    const prepared=prepareReconciliation(initial.input);
    const target=prepared.request.statements.find(s=>s.text===(secondKind==='link_source'?'Capacity is 6.':'Opening is on 12.'))!;
    const result=await applyReconciliation(prepared,[
      {...op('add','Capacity is 6.'),ideaIds:['ambiguous']},
      {...op(secondKind,secondKind==='link_source'?':123:456':'opening moves to 19',target.id),ideaIds:['ambiguous'],statement:'Opening moves to 19.',correctionQuote:'Correction: opening moves to 19.'},
      {...op('add','Tools are inspected.'),ideaIds:['tools']},
    ]);
    expect(result.appliedOperations.map(o=>o.ideaIds)).toEqual([['tools']]);
    expect(result.pending).toContainEqual(expect.objectContaining({ideaIds:['ambiguous'],reason:'reconciliation_multiple_decisions'}));
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
 const result=await applyReconciliation(retry,[{...op('supersede','opening moves to 19',retry.request.statements.find(s=>s.text==='Opening moves to 19.')!.id),ideaIds:['date'],statement:'Opening is scheduled for 19.',correctionQuote:'Correction: opening moves to 19.'},{...op('add','Tools are inspected.'),ideaIds:['tools']}]);
 expect(result.pending).toEqual([]);
 expect(result.content).not.toContain('Opening is scheduled for 19.');
 expect(parseMemoryFacts(parseNote(result.content).frontmatter!.memoryFacts)).toHaveLength(1);
});
it('rejects self-supersession from the same evidence even with a changed idea identity',async()=>{
 const prepared=input('# A\nOpening is on 12.\n[[Index]]\n','Correction: opening moves to 19.');
 const first=await applyReconciliation(prepared,[{...op('supersede','opening moves to 19',prepared.request.statements[0]!.id),statement:'Opening moves to 19.',correctionQuote:'Correction: opening moves to 19.'}]);
 const retrySeed=input(first.content,prepared.input.evidence.content);retrySeed.input.ideas=[{id:'regenerated',topic:'Opening',sourceIds:['p1']}];
 const retry=prepareReconciliation(retrySeed.input);
 const result=await applyReconciliation(retry,[{...op('supersede','opening moves to 19',retry.request.statements.find(s=>s.text==='Opening moves to 19.')!.id),ideaIds:['regenerated'],statement:'Opening is scheduled for 19.',correctionQuote:'Correction: opening moves to 19.'}]);
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
it('requires a compact new correction statement, keeping historical claims host-owned',async()=>{
 const source='Correction: opening is not on 8 but on 15.';
 const prepared=input('# A\nOpening is on 8.\n[[Index]]\n',source);
 for(const statement of [null,'Opening is on 15; the old date was 8.']) {
  const result=await applyReconciliation(prepared,[{...op('supersede','on 15',prepared.request.statements[0]!.id),statement,correctionQuote:source}]);
  expect(result.content).toBe(prepared.input.raw);expect(result.pending.length).toBeGreaterThan(0);
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
 const prepared=prepareReconciliation(seed.input);
 const result=await applyReconciliation(prepared,[{...op(kind,clause,kind==='supersede'?prepared.request.statements[0]!.id:null),sourceIds:['left','right'],ideaIds:['chart'],statement:clause,correctionQuote:kind==='supersede'?correction:null}]);
 expect(result.pending).toEqual([]);expect(result.appliedOperationIds).toHaveLength(1);
 for(const bad of ['gap','overlap','length','bytes','unknown'] as const) {
  const changed=structuredClone(seed.input);
  if(bad==='gap') {changed.sources[1]!.start++;changed.sources[1]!.end++;}
  if(bad==='overlap') {changed.sources[1]!.start--;changed.sources[1]!.end--;}
  if(bad==='length') changed.sources[1]!.end++;
  if(bad==='bytes') changed.sources[1]!.text=changed.sources[1]!.text.replace('paper','metal');
  const rejected=await applyReconciliation(prepareReconciliation(changed),[{...op(kind,clause,kind==='supersede'?prepared.request.statements[0]!.id:null),sourceIds:['left',bad==='unknown'?'missing':'right'],ideaIds:['chart'],statement:clause,correctionQuote:kind==='supersede'?correction:null}]);
  expect(rejected.content,bad).toBe(changed.raw);expect(rejected.pending.length,bad).toBeGreaterThan(0);
 }
});
it('retains independently validated effective-date support around the compact claim',async()=>{
 const claim='The policy requires helmets.';
 const content=claim+' effective 2026-10-01';
 const prepared=input('# A\n[[Index]]\n',content);
 prepared.input.facts=[{key:'policy.helmets',statement:claim,effectiveDate:'2026-10-01',effectiveDateQuote:content,correctionQuote:null,supersedesQuotes:[],verificationQuote:null}];
 const result=await applyReconciliation(prepared,[{...op('add',claim),factKey:'policy.helmets'}]);
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
