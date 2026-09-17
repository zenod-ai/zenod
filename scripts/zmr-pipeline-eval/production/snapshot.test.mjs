import test from 'node:test';
import assert from 'node:assert/strict';
import {modelSnapshot, validateModelSnapshot, sameModelSnapshot} from './snapshot.mjs';

test('projects live owner settings onto the eval model keys only', () => {
  const snapshot = modelSnapshot({
    model_classify: 'openai/gpt-5.6-luna',
    model_classify_reasoning_effort: 'low',
    model_ask: 'openai/gpt-5.6-luna',
    model_ask_reasoning_effort: 'low',
    provider: 'openrouter',
    vault_repo: 'owner/vault',
  });
  assert.deepEqual(snapshot, {
    model_classify: 'openai/gpt-5.6-luna',
    model_classify_reasoning_effort: 'low',
    model_ask: 'openai/gpt-5.6-luna',
    model_ask_reasoning_effort: 'low',
  });
});

test('drops empty values rather than snapshotting a blank model', () => {
  assert.deepEqual(modelSnapshot({model_ask: 'x', model_ask_reasoning_effort: '  ', model_classify: null}), {model_ask: 'x'});
});

test('fails closed on missing required keys and unknown keys', () => {
  assert.throws(() => validateModelSnapshot({model_classify: 'a', model_ask: 'b'}), /missing model value: model_classify_reasoning_effort/);
  assert.throws(() => validateModelSnapshot({model_classify: 'a', model_ask: 'b', model_classify_reasoning_effort: 'low', model_vision: 'v'}), /unknown model key: model_vision/);
  assert.throws(() => validateModelSnapshot(null), /model snapshot is required/);
});

test('accepts the full live snapshot including ask-side effort', () => {
  const models = validateModelSnapshot({model_classify: 'openai/gpt-5.6-luna', model_classify_reasoning_effort: 'low', model_ask: 'openai/gpt-5.6-luna', model_ask_reasoning_effort: 'low'});
  assert.equal(models.model_ask_reasoning_effort, 'low');
});

test('detects a mismatch between deployed owner models and the eval snapshot', () => {
  const live = modelSnapshot({model_ask: 'openai/gpt-5.6-luna', model_ask_reasoning_effort: 'low'});
  assert.equal(sameModelSnapshot(live, {...live}), true);
  assert.equal(sameModelSnapshot(live, {model_ask: 'x-ai/grok-4.3', model_ask_reasoning_effort: 'low'}), false);
  assert.equal(sameModelSnapshot(live, {model_ask: 'openai/gpt-5.6-luna'}), false);
});
