const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createJobStore } = require('../services/bridge/jobs');

test('jobs execute only after approval, persist output, require review and never replay on restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-'));
  let calls = 0;
  let finish;
  try {
    const store = createJobStore({ directory, execute: async (body, progress) => {
      calls++; progress('avance real'); await new Promise(resolve => { finish = resolve; }); return { ok: true, changes: { status: 'M archivo' } };
    } });
    const job = store.create({ task: 'implementar', workspace: 'demo' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 0);
    assert.equal(job.status, 'pending_approval');
    store.action(job.id, 'approve');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1); assert.equal(job.status, 'running'); assert.equal(job.progress, 'avance real');
    assert.throws(() => store.action(job.id, 'approve'), /pendiente/);
    finish(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(job.status, 'awaiting_review');
    store.action(job.id, 'accept'); assert.equal(job.status, 'completed');
    const rejected = store.create({ task: 'otra', workspace: 'demo' });
    store.action(rejected.id, 'reject');
    const restarted = createJobStore({ directory, execute: async () => { calls++; } });
    assert.equal(restarted.get(job.id).status, 'completed');
    assert.equal(restarted.get(rejected.id).status, 'rejected'); assert.equal(calls, 1);
    assert.throws(() => store.create({ task: 'x', workspace: '../fuera' }), /relativo/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
