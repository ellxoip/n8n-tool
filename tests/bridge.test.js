const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const terminal = require('../services/bridge/terminal');
const { createServer, tokensMatch } = require('../services/bridge/server');
const { fakeBackends } = require('./helpers');

const TOKEN = 'test-token-0123456789abcdef';

function tmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

test('resolveWorkspace creates folders inside the root and rejects escapes', () => {
  const root = tmp('ws-');
  try {
    assert.equal(terminal.resolveWorkspace(root, 'proyecto/sub'), path.join(root, 'proyecto', 'sub'));
    assert.equal(terminal.resolveWorkspace(root, ''), root);
    assert.throws(() => terminal.resolveWorkspace(root, '../fuera'), /fuera de/);
    assert.throws(() => terminal.resolveWorkspace(root, '/etc'), /fuera de/);
    assert.throws(() => terminal.resolveWorkspace(root, 'a/../../b'), /fuera de/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveWorkspace rejects symlinks that point outside the root', { skip: process.platform === 'win32' }, () => {
  const root = tmp('ws-');
  const outside = tmp('out-');
  try {
    fs.symlinkSync(outside, path.join(root, 'enlace'));
    assert.throws(() => terminal.resolveWorkspace(root, 'enlace'), /fuera de/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('buildEngineCommand never goes through a shell and validates input', () => {
  const aider = terminal.buildEngineCommand('aider', { task: 'haz X; rm -rf /', model: 'qwen3-coder:30b', ollamaBase: 'http://127.0.0.1:11434' }, {});
  assert.equal(aider.command, 'aider');
  assert.ok(aider.args.includes('ollama_chat/qwen3-coder:30b'));
  assert.equal(aider.args[aider.args.length - 1], 'haz X; rm -rf /', 'la tarea viaja como un unico argumento');
  assert.equal(aider.env.OLLAMA_API_BASE, 'http://127.0.0.1:11434');

  const opencode = terminal.buildEngineCommand('opencode', { task: 't', model: 'm', ollamaBase: 'b' }, {});
  assert.deepEqual(opencode.args.slice(0, 3), ['run', '--model', 'ollama/m']);

  assert.throws(() => terminal.buildEngineCommand('bash', { task: 't', model: 'm' }, {}), /Motor desconocido/);
  assert.throws(() => terminal.buildEngineCommand('aider', { task: ' ', model: 'm' }, {}), /task/);
});

test('allowedTests reads the operator allowlist', () => {
  assert.ok(terminal.allowedTests({}).includes('npm test'));
  assert.deepEqual(terminal.allowedTests({ TERMINAL_CODER_ALLOWED_TESTS: 'make check; ./run.sh ' }), ['make check', './run.sh']);
});

test('tokensMatch compares tokens safely', () => {
  assert.ok(tokensMatch('abc', 'abc'));
  assert.ok(!tokensMatch('abc', 'abd'));
  assert.ok(!tokensMatch('abc', ''));
  assert.ok(!tokensMatch('abc', undefined));
});

async function startBridge() {
  const server = createServer({ token: TOKEN });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, route, body, token = TOKEN) => {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  return { server, call };
}

test('bridge: /health is public, everything else needs the token', async () => {
  const { server, call } = await startBridge();
  try {
    assert.equal((await call('GET', '/health', null, null)).status, 200);
    assert.equal((await call('POST', '/memory/search', { query: 'x' }, null)).status, 401);
    assert.equal((await call('POST', '/terminal/run', { task: 'x' }, 'otro-token')).status, 401);
    assert.equal((await call('GET', '/nope')).status, 404);
  } finally {
    server.close();
  }
});

test('bridge: validates payloads', async () => {
  const { server, call } = await startBridge();
  try {
    assert.equal((await call('POST', '/memory/ingest', {})).status, 400);
    assert.equal((await call('POST', '/memory/search', {})).status, 400);
  } finally {
    server.close();
  }
});

test('bridge: memory ingest + search through HTTP', async () => {
  const backends = await fakeBackends();
  const previous = { ...process.env };
  Object.assign(process.env, { OLLAMA_BASE_URL: backends.ollamaUrl, QDRANT_URL: backends.qdrantUrl, QDRANT_COLLECTION: 'bridge_test' });
  const { server, call } = await startBridge();
  try {
    const ingest = await call('POST', '/memory/ingest', { text: 'QA aprendio: validar rutas.', source: 'qa' });
    assert.equal(ingest.status, 200);
    assert.equal(ingest.body.chunks, 1);
    const found = await call('POST', '/memory/search', { query: 'rutas' });
    assert.equal(found.body.results[0].source, 'qa');
  } finally {
    server.close();
    backends.close();
    for (const key of ['OLLAMA_BASE_URL', 'QDRANT_URL', 'QDRANT_COLLECTION']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});

test('bridge: runs an engine in the workspace, reports the git diff and runs allowed tests', { skip: process.platform === 'win32' }, async () => {
  const root = tmp('bridge-ws-');
  const bin = tmp('bridge-bin-');
  const fakeAider = path.join(bin, 'fake-aider.js');
  fs.writeFileSync(fakeAider, `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync('hecho.txt', 'creado por el motor: ' + process.argv[process.argv.length - 1]);
console.log('motor ok', process.env.OLLAMA_API_BASE);
`, { mode: 0o755 });

  const previous = { ...process.env };
  Object.assign(process.env, {
    TERMINAL_CODER_WORKSPACE: root,
    TERMINAL_CODER_AIDER_CMD: fakeAider,
    TERMINAL_CODER_ALLOWED_TESTS: 'node -e process.exit(0);node -e process.exit(3)',
    OLLAMA_BASE_URL: 'http://127.0.0.1:1',
  });
  const { server, call } = await startBridge();
  try {
    const project = path.join(root, 'demo');
    fs.mkdirSync(project);
    execFileSync('git', ['init', '-q'], { cwd: project });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: project });

    const ok = await call('POST', '/terminal/run', { task: 'crea un archivo', workspace: 'demo', model: 'qwen3-coder:30b', test: 'node -e process.exit(0)' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.ok, true);
    assert.match(ok.body.output, /motor ok http:\/\/127\.0\.0\.1:1/);
    assert.equal(fs.readFileSync(path.join(project, 'hecho.txt'), 'utf8'), 'creado por el motor: crea un archivo');
    assert.equal(ok.body.tests.passed, true);
    assert.match(ok.body.changes.status, /hecho\.txt/);

    const failing = await call('POST', '/terminal/run', { task: 'otra', workspace: 'demo', model: 'm', test: 'node -e process.exit(3)' });
    assert.equal(failing.body.ok, false);
    assert.equal(failing.body.tests.passed, false);

    const forbidden = await call('POST', '/terminal/run', { task: 'x', workspace: 'demo', model: 'm', test: 'rm -rf /' });
    assert.equal(forbidden.status, 400);
    assert.match(forbidden.body.error, /no permitido/);

    const escape = await call('POST', '/terminal/run', { task: 'x', workspace: '../../etc', model: 'm' });
    assert.equal(escape.status, 500);
    assert.match(escape.body.error, /fuera de/);
  } finally {
    server.close();
    for (const key of ['TERMINAL_CODER_WORKSPACE', 'TERMINAL_CODER_AIDER_CMD', 'TERMINAL_CODER_ALLOWED_TESTS', 'OLLAMA_BASE_URL']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('bridge: reports a missing engine instead of crashing', { skip: process.platform === 'win32' }, async () => {
  const root = tmp('bridge-ws-');
  const previous = { ...process.env };
  Object.assign(process.env, { TERMINAL_CODER_WORKSPACE: root, TERMINAL_CODER_AIDER_CMD: path.join(root, 'no-existe') });
  const { server, call } = await startBridge();
  try {
    const res = await call('POST', '/terminal/run', { task: 'x', model: 'm' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /no esta instalado/);
  } finally {
    server.close();
    for (const key of ['TERMINAL_CODER_WORKSPACE', 'TERMINAL_CODER_AIDER_CMD']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
