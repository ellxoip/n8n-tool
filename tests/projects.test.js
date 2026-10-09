const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { inspectProject } = require('../services/bridge/projects');

test('project inspection reads documentation, limits output and rejects private paths and symlink escapes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-inspect-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'project-outside-'));
  const env = { TERMINAL_CODER_WORKSPACE: root, PROJECT_READ_ROOTS: root };
  try {
    fs.writeFileSync(path.join(root, 'README.md'), 'Project description');
    fs.writeFileSync(path.join(root, '.env'), 'PASSWORD=secret');
    fs.writeFileSync(path.join(root, 'long.txt'), 'x'.repeat(20000));
    fs.writeFileSync(path.join(outside, 'outside.txt'), 'outside');
    fs.symlinkSync(path.join(outside, 'outside.txt'), path.join(root, 'escape.txt'));
    const result = inspectProject(root, env);
    assert.equal(result.documents[0].text, 'Project description');
    assert.ok(!result.entries.some(e => e.name === '.env'));
    assert.ok(!result.documents.some(e => e.file === 'escape.txt'));
    assert.equal(inspectProject(path.join(root, 'long.txt'), env).text.length, 16000);
    assert.throws(() => inspectProject(path.join(root, '.env'), env), /privado/);
    assert.throws(() => inspectProject(path.join(root, 'escape.txt'), env), /fuera/);
    assert.throws(() => inspectProject(outside, env), /fuera/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
