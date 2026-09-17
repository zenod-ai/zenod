import { expect, it, vi } from 'vitest';
import type { BrainLlm, Classification, ClassifyInput } from '../src/llm/types.js';
import { JevClient } from '../src/llm/jev.js';
import { withJevClassify, type ClassifyOutcome } from '../src/llm/classifyFallback.js';

const TEXT = 'Renewed the home insurance with Allianz. The premium is now 1240 EUR a year.';

function input(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    content: TEXT,
    hints: [],
    pageIndex: [
      { path: 'Areas/Insurance.md', title: 'Insurance', tags: ['insurance'], summary: 'Home and travel insurance.' },
      { path: 'Notes/Reading.md', title: 'Reading', tags: ['reference'], summary: 'Books and papers.' },
    ] as ClassifyInput['pageIndex'],
    tagVocabulary: ['insurance', 'reference'],
    sourcePassages: [{ id: 'p0', start: 0, end: TEXT.length, text: TEXT }],
    sourceRange: { start: 0, end: TEXT.length },
    ...overrides,
  };
}

const PRIMARY: Classification = { confidence: 0.9, summary: 'primary', tags: ['insurance'], pages: [] };

/** A Jev responder that answers every question the client asks, shaped like the real API. */
function fakeJev(overrides: { destination?: string; destinationConfidence?: number; dispositionConfidence?: number; unitProb?: number; multiPageProb?: number } = {}) {
  const calls: any[] = [];
  const fetchImpl = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const p = overrides.multiPageProb ?? 0;
    const answers: Record<string, unknown> = {};
    for (const [key, question] of Object.entries<any>(body.questions)) {
      if (question.type === 'choice') {
        const isScope = key === 'multiple_propositions';
        answers[key] = {
          type: 'choice',
          choice: key === 'destination' ? (overrides.destination ?? 'pg0') : isScope ? (p >= 0.5 ? 'multiple_pages' : 'single_page') : 'append_compact_note',
          confidence: key === 'destination' ? (overrides.destinationConfidence ?? 0.95) : (overrides.dispositionConfidence ?? 0.95),
          probabilities: isScope ? { single_page: 1 - p, multiple_pages: p } : {},
        };
      } else {
        const isUnit = String(question.instructions).includes('source unit');
        answers[key] = { type: 'noul', noul: isUnit ? (overrides.unitProb ?? 0.95) : 0.2 };
      }
    }
    return new Response(JSON.stringify({ model: 'jev-test', answers, usage: { input_tokens: 100, output_tokens: 10 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function client(fetchImpl: typeof fetch) {
  return new JevClient({ apiKey: 'test', fetchImpl, timeoutMs: 100 });
}

function primaryLlm(result: Classification = PRIMARY) {
  const classify = vi.fn(async () => result);
  return { llm: { classify } as unknown as BrainLlm, classify };
}

const fast = { attempts: 1, retryBaseMs: 1, sleep: async () => {} };

it('routes to jev and returns an assembled classification without calling the primary', async () => {
  const { fetchImpl } = fakeJev();
  const { llm, classify } = primaryLlm();
  const outcomes: ClassifyOutcome[] = [];
  const wrapped = withJevClassify(llm, { client: client(fetchImpl), ...fast, onOutcome: (o) => outcomes.push(o) });

  const result = await wrapped.classify(input());

  expect(classify).not.toHaveBeenCalled();
  expect(outcomes[0]?.route).toBe('jev');
  expect(result.topics).toHaveLength(1);
  expect(result.topics![0]!.disposition).toBe('append_compact_note');
  expect(result.topics![0]!.pages[0]!.path).toBe('Areas/Insurance.md');
  // Evidence is host-derived from unit ids; the model never supplies text.
  const assignments = result.topics![0]!.evidenceAssignments!;
  expect(assignments.length).toBeGreaterThan(0);
  expect(assignments.map((a) => a.quote).join(' ')).toContain('Allianz');
  expect(result.topics![0]!.evidenceQuotes).toEqual([]);
});

it('falls back when routing confidence is below the threshold', async () => {
  const { fetchImpl } = fakeJev({ destinationConfidence: 0.4 });
  const { llm, classify } = primaryLlm();
  const outcomes: ClassifyOutcome[] = [];
  const wrapped = withJevClassify(llm, { client: client(fetchImpl), ...fast, onOutcome: (o) => outcomes.push(o) });

  const result = await wrapped.classify(input());

  expect(classify).toHaveBeenCalledTimes(1);
  expect(result).toBe(PRIMARY);
  expect(outcomes[0]).toMatchObject({ route: 'primary', reason: 'low_confidence' });
});

it('falls back when no source unit is selected, rather than filing without evidence', async () => {
  const { fetchImpl } = fakeJev({ unitProb: 0.1 });
  const { llm, classify } = primaryLlm();
  const outcomes: ClassifyOutcome[] = [];
  const wrapped = withJevClassify(llm, { client: client(fetchImpl), ...fast, onOutcome: (o) => outcomes.push(o) });

  const result = await wrapped.classify(input());

  expect(classify).toHaveBeenCalledTimes(1);
  expect(result).toBe(PRIMARY);
  expect(outcomes[0]).toMatchObject({ route: 'primary', reason: 'incomplete_evidence' });
});

it('falls back when jev names a destination that is not in the supplied catalog', async () => {
  const { fetchImpl } = fakeJev({ destination: 'pg999' });
  const { llm, classify } = primaryLlm();
  const outcomes: ClassifyOutcome[] = [];
  const wrapped = withJevClassify(llm, { client: client(fetchImpl), ...fast, onOutcome: (o) => outcomes.push(o) });

  const result = await wrapped.classify(input());

  expect(classify).toHaveBeenCalledTimes(1);
  expect(result).toBe(PRIMARY);
  expect(outcomes[0]).toMatchObject({ route: 'primary', reason: 'unavailable', errorType: 'response_invalid' });
});

it('skips jev entirely for corrective retries and for requests without source passages', async () => {
  const { fetchImpl, calls } = fakeJev();
  const { llm, classify } = primaryLlm();
  const wrapped = withJevClassify(llm, { client: client(fetchImpl), ...fast });

  await wrapped.classify(input({ retryDecisions: [{ id: 'd1', topic: {} as any, reason: 'r', scope: 'decision' }] }));
  await wrapped.classify(input({ sourcePassages: undefined, sourceRange: undefined }));

  expect(calls).toHaveLength(0);
  expect(classify).toHaveBeenCalledTimes(2);
});

it('opens the circuit breaker after consecutive failures and stops calling a struggling provider', async () => {
  let fetchCount = 0;
  const failing = (async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({ detail: { error_type: 'model_unavailable', message: 'down' } }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  const { llm, classify } = primaryLlm();
  const outcomes: ClassifyOutcome[] = [];
  const wrapped = withJevClassify(llm, {
    client: client(failing),
    ...fast,
    breakerFailures: 3,
    breakerCooldownMs: 10_000,
    now: () => 1000,
    onOutcome: (o) => outcomes.push(o),
  });

  for (let i = 0; i < 4; i++) await wrapped.classify(input());

  expect(fetchCount).toBe(3); // fourth request skipped: breaker is open
  expect(classify).toHaveBeenCalledTimes(4);
  expect(outcomes[3]).toMatchObject({ route: 'primary', reason: 'circuit_open' });
  expect(outcomes[0]).toMatchObject({ route: 'primary', reason: 'unavailable', errorType: 'model_unavailable' });
});

it('closes the breaker again after the cooldown and resumes routing', async () => {
  const good = fakeJev();
  let phase = 0;
  let fetchCount = 0;
  let clock = 0;
  const flaky = (async (url: string, init: any) => {
    fetchCount += 1;
    if (phase < 3) {
      phase += 1;
      return new Response(JSON.stringify({ detail: { error_type: 'model_unavailable' } }), { status: 503 });
    }
    return good.fetchImpl(url, init);
  }) as unknown as typeof fetch;
  const { llm } = primaryLlm();
  const outcomes: ClassifyOutcome[] = [];
  const wrapped = withJevClassify(llm, {
    client: client(flaky),
    ...fast,
    breakerFailures: 3,
    breakerCooldownMs: 10_000,
    now: () => clock,
    onOutcome: (o) => outcomes.push(o),
  });

  for (let i = 0; i < 3; i++) await wrapped.classify(input());
  expect(fetchCount).toBe(3);

  clock = 20_000; // cooldown elapsed
  await wrapped.classify(input());

  expect(fetchCount).toBe(4); // Jev was attempted again rather than staying short-circuited
  expect(outcomes.at(-1)).toMatchObject({ route: 'jev' });
});

it('falls back when the memory looks like it needs more than one page', async () => {
  const { fetchImpl } = fakeJev({ multiPageProb: 0.9 });
  const { llm, classify } = primaryLlm();
  const outcomes: ClassifyOutcome[] = [];
  const wrapped = withJevClassify(llm, { client: client(fetchImpl), ...fast, onOutcome: (o) => outcomes.push(o) });

  const result = await wrapped.classify(input());

  expect(classify).toHaveBeenCalledTimes(1);
  expect(result).toBe(PRIMARY);
  expect(outcomes[0]).toMatchObject({ route: 'primary', reason: 'multi_topic' });
});

it('still files a single-page memory when the second-page probability is low', async () => {
  const { fetchImpl } = fakeJev({ multiPageProb: 0.2 });
  const { llm, classify } = primaryLlm();
  const wrapped = withJevClassify(llm, { client: client(fetchImpl), ...fast });

  const result = await wrapped.classify(input());

  expect(classify).not.toHaveBeenCalled();
  expect(result.topics![0]!.pages[0]!.path).toBe('Areas/Insurance.md');
});

it('never throws when the client fails unexpectedly', async () => {
  const exploding = (async () => {
    throw new TypeError('socket hang up');
  }) as unknown as typeof fetch;
  const { llm, classify } = primaryLlm();
  const wrapped = withJevClassify(llm, { client: client(exploding), ...fast });

  await expect(wrapped.classify(input())).resolves.toBe(PRIMARY);
  expect(classify).toHaveBeenCalledTimes(1);
});
