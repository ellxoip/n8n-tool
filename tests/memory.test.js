const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const memory = require('../scripts/lib/memory');
const { fakeBackends } = require('./helpers');

test('chunkText keeps short text whole and splits long text with bounded chunks', () => {
  assert.deepEqual(memory.chunkText('  hola  '), ['hola']);
  assert.deepEqual(memory.chunkText(''), []);
  const long = Array.from({ length: 40 }, (_, i) => `Parrafo ${i}. ${'palabra '.repeat(40)}`).join('\n\n');
  const chunks = memory.chunkText(long, { size: 1000, overlap: 100 });
  assert.ok(chunks.length > 3);
  for (const chunk of chunks) assert.ok(chunk.length <= 1100, `chunk de ${chunk.length}`);
  assert.ok(chunks.join('\n').includes('Parrafo 39'));
});

test('chunkText splits one giant paragraph', () => {
  const chunks = memory.chunkText('x'.repeat(5000), { size: 1000, overlap: 100 });
  assert.ok(chunks.length >= 5);
});

test('pointId is deterministic and UUID-shaped', () => {
  const a = memory.pointId('doc.md', 0, 'texto');
  assert.equal(a, memory.pointId('doc.md', 0, 'texto'));
  assert.notEqual(a, memory.pointId('doc.md', 1, 'texto'));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('ingest creates the collection with the embedding dimension and is idempotent', async () => {
  const backends = await fakeBackends({ dimension: 6 });
  try {
    const cfg = { ollamaBase: backends.ollamaUrl, qdrantBase: backends.qdrantUrl, collection: 't1', embedModel: 'nomic-embed-text:latest' };
    const first = await memory.ingestText({ text: 'Decision: usar Qdrant.', source: 'adr-1' }, cfg);
    await memory.ingestText({ text: 'Decision: usar Qdrant.', source: 'adr-1' }, cfg);
    assert.equal(first.chunks, 1);
    assert.equal(backends.state.collections.t1.size, 6);
    assert.equal(backends.state.collections.t1.points.size, 1, 're-ingestar no duplica');

    const { results } = await memory.search({ query: 'Qdrant' }, cfg);
    assert.equal(results[0].source, 'adr-1');
    assert.match(results[0].text, /Qdrant/);
  } finally {
    backends.close();
  }
});

test('ingest rejects a collection created with another embedding dimension', async () => {
  const backends = await fakeBackends({ dimension: 4 });
  try {
    backends.state.collections.t2 = { size: 768, points: new Map() };
    const cfg = { ollamaBase: backends.ollamaUrl, qdrantBase: backends.qdrantUrl, collection: 't2', embedModel: 'x' };
    await assert.rejects(memory.ingestText({ text: 'algo' }, cfg), /768 dimensiones/);
  } finally {
    backends.close();
  }
});

test('search on a missing collection returns no results', async () => {
  const backends = await fakeBackends();
  try {
    const cfg = { ollamaBase: backends.ollamaUrl, qdrantBase: backends.qdrantUrl, collection: 'nada', embedModel: 'x' };
    assert.deepEqual((await memory.search({ query: 'hola' }, cfg)).results, []);
  } finally {
    backends.close();
  }
});

test('ingestPath indexes text files and skips binaries and ignored folders', async () => {
  const backends = await fakeBackends();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'));
  try {
    fs.writeFileSync(path.join(dir, 'notas.md'), '# Notas\ncontenido');
    fs.writeFileSync(path.join(dir, 'imagen.png'), Buffer.from([0, 1, 2]));
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'ignorado');
    const cfg = { ollamaBase: backends.ollamaUrl, qdrantBase: backends.qdrantUrl, collection: 't3', embedModel: 'x' };
    const seen = [];
    const summary = await memory.ingestPath(dir, cfg, (source) => seen.push(source));
    assert.deepEqual(seen, ['notas.md']);
    assert.equal(summary.files, 1);
    assert.equal(summary.skipped, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    backends.close();
  }
});

test('embedding failure explains how to pull the model', async () => {
  const cfg = { ollamaBase: 'http://127.0.0.1:1', qdrantBase: 'http://127.0.0.1:1', collection: 'c', embedModel: 'nomic-embed-text:latest' };
  await assert.rejects(memory.search({ query: 'x' }, cfg), /Ollama no responde/);
});
