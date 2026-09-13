import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { scanVault } from '../src/vault/pages.js';
import { candidatePages, classifyCandidates, branchContext } from '../src/engine/meaningNotes.js';
import { serializeNote } from '../src/vault/frontmatter.js';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function vault() { const path = await mkdtemp(join(tmpdir(), 'zmr12-')); dirs.push(path); await mkdir(join(path, 'Projects')); return path; }
const fm = (title: string) => ({ title, type: 'project', tags: [], summary: 'Trading execution and orders.' });
it('discovers legacy PatronBTC from late source detail among hundreds of unrelated branches', async () => {
  const dir = await vault();
  await Promise.all(Array.from({length: 200}, (_, i) => writeFile(join(dir, `Projects/Branch${i}.md`), serializeNote(fm(`Branch${i}`), 'Ingestion transport metadata archive storage.'))));
  const legacy = '# PatronBTC\n\nEducational Bitcoin video.\n\n## Logarithms\nExplain orders of magnitude, network effects and power laws.\n[[Projects/Mathematics]]\n';
  await writeFile(join(dir, 'Projects/Altamira2050 PatronBTC.md'), legacy);
  await writeFile(join(dir, 'Projects/Poly-Maker.md'), serializeNote(fm('Poly-Maker'), 'Automated market making and trading.'));
  const snapshot = await scanVault(dir);
  const content = 'Ingestion transport archive metadata. '.repeat(80) + Array.from({length: 80}, (_, i) => `contextword${i}`).join(' ') + '\nPatronBTC educational Bitcoin video logarithms orders of magnitude.';
  const pages = await candidatePages(dir, snapshot, content, []);
  expect(pages.slice(0, 8).map(page => page.path)).toContain('Projects/Altamira2050 PatronBTC.md');
  const page = snapshot.pages.find(page => page.title === 'PatronBTC')!;
  expect(page).toMatchObject({ writable: false, type: 'project' });
  expect(page.links).toContain('Projects/Mathematics');
  expect(page.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(await readFile(join(dir, page.path), 'utf8')).toBe(legacy);
});
it('rebuilds only changed catalog entries and isolates tenants while keeping section identities', async () => {
  const dir = await vault(); const other = await vault();
  for (const path of [dir, other]) await writeFile(join(path, 'Projects/A.md'), '# A\n\n## Video\nOriginal claim.\n');
  await writeFile(join(dir, 'Projects/B.md'), '# B\nUnchanged.');
  const first = await scanVault(dir);
  await writeFile(join(dir, 'Projects/A.md'), '# A\n\n## Video\nCorrected claim.\n');
  const next = await scanVault(dir); const isolated = await scanVault(other);
  expect(next.pages[1]).toEqual(first.pages[1]);
  expect(next.pages[0]!.id).toBe(first.pages[0]!.id);
  expect(next.pages[0]!.revision).not.toBe(first.pages[0]!.revision);
  expect(next.pages[0]!.sections![1]!.id).toBe(first.pages[0]!.sections![1]!.id);
  expect(isolated.pages[0]!.revision).toBe(first.pages[0]!.revision);
  expect(next.catalogCoverage).toMatchObject({ reused: 1, rebuilt: 1, unreadable: [] });
});
it('groups topics into one bounded revision-checked branch packet with explicit coverage', async () => {
  const dir = await vault();
  await writeFile(join(dir, 'Projects/A.md'), '# A\n\n## Travel\nPassport renewal in April.\n\n## Video\nLogarithms education.\n' + 'Details '.repeat(3000));
  const snapshot = await scanVault(dir);
  const packet = await branchContext(dir, snapshot, [
    { topic: 'travel', query: 'passport renewal', paths: ['Projects/A.md'] },
    { topic: 'video', query: 'logarithms education', paths: ['Projects/A.md'] },
  ]);
  expect(packet.branches).toHaveLength(1);
  expect(packet.branches[0]!.topics).toEqual(['travel', 'video']);
  expect(packet.branches[0]!.sections.some(section => section.text.includes('Passport renewal'))).toBe(true);
  expect(packet.partial).toBe(true);
  expect(packet.contextChars).toBeLessThanOrEqual(12000);
  expect(packet.estimatedTokens).toBe(Math.ceil(packet.contextChars / 4));
  await writeFile(join(dir, 'Projects/A.md'), '# A\nChanged since scan.');
  const stale = await branchContext(dir, snapshot, [{ topic: 'travel', query: 'passport', paths: ['Projects/A.md'] }]);
  expect(stale.partial).toBe(true);
  expect(stale.branches).toHaveLength(0);
  expect(stale.omitted).toContain('Projects/A.md:revision_changed');
});
it('does one topic fallback and prevents partial discovery from authorizing confident new pages', async () => {
  const dir = await vault();
  await Promise.all(Array.from({length: 40}, (_, i) => writeFile(join(dir, `Projects/Branch${i}.md`), '# Branch\nArchive.')));
  const snapshot = await scanVault(dir);
  snapshot.catalogCoverage!.unreadable.push('Projects/Unavailable.md');
  const created = { path: 'Projects/New.md', title: 'New', action: 'create' as const };
  const classify = vi.fn().mockResolvedValue({ confidence: 0.99, summary: 'unknown', tags: [], pages: [created], topics: [{ topic: 'unknown', summary: 'unknown', evidenceQuotes: ['New idea'], disposition: 'integrate_page', confidence: 0.99, pages: [created] }] });
  const result = await classifyCandidates({ classify }, dir, snapshot, { content: 'New idea', hints: [], pageIndex: snapshot.pages, tagVocabulary: [] });
  expect(classify).toHaveBeenCalledTimes(2);
  expect(result.topics![0]!.confidence).toBeLessThan(0.7);
  expect(result.topics![0]).toMatchObject({ disposition: "needs_clarification", pages: [] });
  expect(result).toMatchObject({ disposition: "needs_clarification", pages: [] });
  expect(classify.mock.calls[1]![0].hints.join(' ')).toContain('partial');
  expect(result.discovery).toMatchObject({partial: true, totalPages: 40, fallbackAttempted: true, fallbackFailed: false});
});
it('finds aliases and malformed-frontmatter pages without normalizing source bytes', async () => {
  const dir = await vault();
  const legacy = '---\ntitle: [broken\n---\n# Mathematics\nNetwork education and logarithms.\n';
  await writeFile(join(dir, 'Projects/Mathematics.md'), legacy);
  await writeFile(join(dir, 'Projects/Video.md'), serializeNote({...fm('Video'), aliases: ['PatronBTC']}, 'Education.'));
  const snapshot = await scanVault(dir);
  expect(snapshot.pages.find(page => page.title === 'Mathematics')).toMatchObject({ writable: false });
  expect((await candidatePages(dir, snapshot, 'PatronBTC', []))[0]!.path).toBe('Projects/Video.md');
  expect(await readFile(join(dir, 'Projects/Mathematics.md'), 'utf8')).toBe(legacy);
});
it('retains clear existing topic decisions while ambiguous creation remains pending', async () => {
  const dir = await vault();
  await Promise.all(Array.from({length: 30}, (_, i) => writeFile(join(dir, `Projects/Branch${i}.md`), `# Branch${i}\nArchive.`)));
  const snapshot = await scanVault(dir);
  const existing = { path: 'Projects/Branch0.md', title: 'Branch0', action: 'update' as const };
  const created = { path: 'Projects/New.md', title: 'New', action: 'create' as const };
  const topic = { topic: 'existing', summary: 'Branch0', evidenceQuotes: ['Branch0'], disposition: 'append_compact_note' as const, confidence: 0.95, pages: [existing] };
  const classify = vi.fn().mockResolvedValue({confidence: 0.95, summary: 'mixed', tags: [], pages: [existing, created], topics: [topic, {...topic, topic: 'new', summary: 'unknown', confidence: 0.5, pages: [created]}]});
  const result = await classifyCandidates({classify}, dir, snapshot, {content: 'Branch0 and unknown', hints: [], pageIndex: snapshot.pages, tagVocabulary: []});
  expect(result.topics![0]).toMatchObject(topic);
  expect(result.topics![1]).toMatchObject({disposition: 'needs_clarification', pages: []});
});
it('returns relevant text from the tail of an oversized section with exact source offsets', async () => {
  const dir = await vault();
  await writeFile(join(dir, 'Projects/A.md'), '# A\n\n## Notes\n' + 'Old background. '.repeat(2000) + 'Zebrafish research began yesterday.\n');
  const packet = await branchContext(dir, await scanVault(dir), [{topic: 'research', query: 'Old background Zebrafish research', paths: ['Projects/A.md']}]);
  expect(packet.branches[0]!.sections[0]!.text).toContain('Zebrafish research');
  expect(packet.branches[0]!.sections[0]!.excerptStart).toBeGreaterThan(20000);
  expect(packet.partial).toBe(true);
});

it('allows a genuinely new project after successful bounded discovery in a large vault', async () => {
  const dir = await vault();
  await Promise.all(Array.from({length: 40}, (_, i) => writeFile(join(dir, `Projects/Branch${i}.md`), '# Archive\nTrading operations.')));
  const snapshot = await scanVault(dir);
  const created = {path: 'Projects/Zebrafish.md', title: 'Zebrafish', action: 'create' as const};
  const proposal = {confidence: 0.99, summary: 'Start an independent zebrafish breeding research project', tags: [], disposition: 'integrate_page' as const, pages: [created]};
  const classify = vi.fn().mockResolvedValue(proposal);
  const result = await classifyCandidates({classify}, dir, snapshot, {content: proposal.summary, hints: [], pageIndex: snapshot.pages, tagVocabulary: []});
  expect(classify).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject(proposal);
  expect(result.discovery).toMatchObject({partial: false, contextPartial: true, fallbackAttempted: true, fallbackFailed: false});
  const failed = vi.fn().mockResolvedValueOnce(proposal).mockRejectedValueOnce(new Error('unavailable'));
  const blocked = await classifyCandidates({classify: failed}, dir, snapshot, {content: proposal.summary, hints: [], pageIndex: snapshot.pages, tagVocabulary: []});
  expect(blocked).toMatchObject({disposition: 'needs_clarification', pages: [], discovery: {partial: true, fallbackFailed: true}});
});
