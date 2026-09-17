import test from 'node:test';
import assert from 'node:assert/strict';
import {loadExpectations, parseExpectations, literalChecks} from './expectations.mjs';

const expectations = loadExpectations();

test('covers exactly the twelve frozen cases with literals and conditions', () => {
  assert.equal(expectations.version, 'm2-expectations-v1');
  for (let i = 1; i <= 12; i++) {
    const id = `B${String(i).padStart(2, '0')}`;
    assert.ok(expectations.cases[id], `missing ${id}`);
    assert.ok(expectations.cases[id].requiredFacts.length > 0, `${id} has literals`);
  }
});

test('literal checks report present facts and detect forbidden output', () => {
  const good = literalChecks(expectations, 'B02', 'Your reservation is 18 November 2026 at 14:30, code KILN-47.');
  assert.deepEqual(good.requiredFacts.filter((f) => f.present).map((f) => f.fact), ['18 November 2026', '14:30', 'KILN-47']);
  const bad = literalChecks(expectations, 'B07', 'You should buy a new red wheel.');
  assert.equal(bad.requiredFacts.find((f) => f.fact === 'blue wheel').present, false);
  assert.equal(bad.forbidden.find((f) => f.fact === 'red wheel').present, true);
});

test('fails closed on malformed expectations', () => {
  assert.throws(() => parseExpectations(null), /not an object/);
  assert.throws(() => parseExpectations({version: 'v', cases: {}}), /missing case B01/);
  const broken = JSON.parse(JSON.stringify(expectations));
  broken.cases.B03.requiredFacts = [''];
  assert.throws(() => parseExpectations(broken), /requiredFacts/);
  broken.cases.B03.requiredFacts = ['x'];
  broken.cases.B03.requireCitation = 'yes';
  assert.throws(() => parseExpectations(broken), /requireCitation/);
});
