const test = require('node:test');
const assert = require('node:assert/strict');

const { loadModelConfig, resolveRole, resolveAll, sameModel, candidatesFor } = require('../scripts/lib/models');

const config = loadModelConfig();

test('config: every role defines a preferred model', () => {
  for (const [role, spec] of Object.entries(config.roles)) {
    assert.ok(spec.preferred, role);
  }
});

test('sameModel treats a bare name as :latest', () => {
  assert.ok(sameModel('mistral-small', 'mistral-small:latest'));
  assert.ok(!sameModel('qwen3:4b', 'qwen3:8b'));
});

test('resolveRole prefers the preferred model when installed', () => {
  const info = resolveRole('analyst', ['deepseek-r1:14b', config.roles.analyst.preferred], config, {});
  assert.equal(info.selected, config.roles.analyst.preferred);
  assert.equal(info.usingFallback, false);
  assert.equal(info.installed, true);
});

test('resolveRole falls back to an installed legacy model', () => {
  const fallback = config.roles.analyst.fallbacks[0];
  const info = resolveRole('analyst', [fallback], config, {});
  assert.equal(info.selected, fallback);
  assert.equal(info.usingFallback, true);
  assert.equal(info.installed, true);
});

test('resolveRole reports a missing model and keeps the preferred one', () => {
  const info = resolveRole('programmer', ['llama3:8b'], config, {});
  assert.equal(info.selected, config.roles.programmer.preferred);
  assert.equal(info.installed, false);
  assert.equal(info.verified, true);
});

test('resolveRole does not verify when Ollama is unreachable', () => {
  const info = resolveRole('vision', [], config, {});
  assert.equal(info.verified, false);
  assert.equal(info.selected, config.roles.vision.preferred);
});

test('env override has priority and is deduplicated', () => {
  const env = { OLLAMA_MODEL_SUPERVISOR: 'my-router:1b' };
  assert.equal(candidatesFor('supervisor', config, env)[0], 'my-router:1b');
  assert.equal(resolveRole('supervisor', ['my-router:1b'], config, env).selected, 'my-router:1b');

  const dup = candidatesFor('supervisor', config, { OLLAMA_MODEL_SUPERVISOR: config.roles.supervisor.preferred });
  assert.equal(new Set(dup).size, dup.length);
});

test('resolveAll returns every role', () => {
  assert.deepEqual(Object.keys(resolveAll([], config, {})), Object.keys(config.roles));
});
