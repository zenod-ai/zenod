import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

// E24-M3: one DeepSeek filing answer with many uncertain topics started eight whole-vault searches at
// once and ran Zenod out of memory (production 2026-11-10, 3 restarts). Count searches in flight.
const flight = vi.hoisted(() => ({ now: 0, max: 0 }));
vi.mock('../src/ops/search.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/ops/search.js')>();
  return { ...original, searchVault: async (...args: Parameters<typeof original.searchVault>) => {
    flight.now++; flight.max = Math.max(flight.max, flight.now);
    try { await new Promise(resolve => setTimeout(resolve, 5)); return await original.searchVault(...args); }
    finally { flight.now--; }
  } };
});
const { classifyCandidates } = await import('../src/engine/meaningNotes.js');
const { searchVault, MAX_BODY_LINE_CHARS } = await import('../src/ops/search.js');
const { scanVault } = await import('../src/vault/pages.js');

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function vault() { const path = await mkdtemp(join(tmpdir(), 'e24m3-')); dirs.push(path); await mkdir(join(path, 'Projects')); await mkdir(join(path, 'Log')); return path; }

it('searches the fallback catalog one topic at a time when an answer has many uncertain topics', async () => {
  const dir = await vault();
  await Promise.all(Array.from({ length: 40 }, (_, i) => writeFile(join(dir, `Projects/Branch${i}.md`), `# Branch${i}\nArchive plan launch.`)));
  const snapshot = await scanVault(dir);
  const created = (i: number) => ({ path: `Projects/New${i}.md`, title: `New${i}`, action: 'create' as const });
  const topics = Array.from({ length: 10 }, (_, i) => ({ topic: `idea ${i}`, summary: `launch plan idea ${i}`, evidenceQuotes: [`idea ${i}`], disposition: 'integrate_page' as const, confidence: 0.5, pages: [created(i)] }));
  const classify = vi.fn().mockResolvedValue({ confidence: 0.5, summary: 'many', tags: [], pages: [], topics });
  flight.max = 0;
  const result = await classifyCandidates({ classify }, dir, snapshot, { content: topics.map(t => t.topic).join('. '), hints: [], pageIndex: snapshot.pages, tagVocabulary: [] });
  expect(classify).toHaveBeenCalledTimes(2);
  expect(result.discovery).toMatchObject({ fallbackAttempted: true, fallbackFailed: false });
  expect(flight.max).toBe(1);
});

it('keeps a body search bounded on a vault whose every long line matches', async () => {
  const dir = await vault();
  const line = `- 10:00 ${'plan launch tester memory '.repeat(400)}`;
  await Promise.all(Array.from({ length: 12 }, (_, i) => writeFile(join(dir, `Log/2026-11-${String(i + 1).padStart(2, '0')}.md`), `# Log\n\n${Array.from({ length: 600 }, () => line).join('\n')}\n`)));
  await writeFile(join(dir, 'Projects/Launch.md'), '---\ntitle: Launch\ntype: project\ntags: []\nsummary: Launch plan.\n---\n# Launch\nTester plan.\n');
  expect(line.length).toBeGreaterThan(MAX_BODY_LINE_CHARS);
  const hits = await searchVault(dir, 'plan launch tester memory');
  expect(hits.map(hit => hit.path)).toContain('Projects/Launch.md');
  expect(hits.length).toBeGreaterThan(1);
  expect(hits.every(hit => hit.snippet.length <= 200)).toBe(true);
});
