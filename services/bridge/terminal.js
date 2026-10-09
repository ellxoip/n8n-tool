const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ENGINES = ['aider', 'opencode'];
const DEFAULT_TESTS = ['npm test', 'npm run lint', 'pytest -q', 'python -m pytest -q', 'go test ./...', 'cargo test'];
const MAX_OUTPUT_BYTES = 60 * 1024;

function workspaceRoot(env = process.env) {
  const configured = env.TERMINAL_CODER_WORKSPACE || path.join(__dirname, '..', '..', 'workspace');
  return path.resolve(configured);
}

/**
 * Resolves `relative` inside the workspace root and refuses anything that escapes it,
 * including via symlinks. The root itself is created when missing.
 */
function resolveWorkspace(rootDir, relative = '.') {
  fs.mkdirSync(rootDir, { recursive: true });
  const realRoot = fs.realpathSync(rootDir);
  const target = path.resolve(realRoot, String(relative || '.'));
  if (!fs.existsSync(target)) {
    const inside = path.relative(realRoot, target);
    if (inside.startsWith('..') || path.isAbsolute(inside)) {
      throw new Error('El workspace pedido queda fuera de TERMINAL_CODER_WORKSPACE.');
    }
    fs.mkdirSync(target, { recursive: true });
  }
  const realTarget = fs.realpathSync(target);
  const rel = path.relative(realRoot, realTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('El workspace pedido queda fuera de TERMINAL_CODER_WORKSPACE.');
  }
  return realTarget;
}

function allowedTests(env = process.env) {
  const raw = env.TERMINAL_CODER_ALLOWED_TESTS;
  const list = raw ? raw.split(';') : DEFAULT_TESTS;
  return list.map((entry) => entry.trim()).filter(Boolean);
}

function buildEngineCommand(engine, { task, model, ollamaBase }, env = process.env) {
  if (!ENGINES.includes(engine)) throw new Error(`Motor desconocido: ${engine}. Usa ${ENGINES.join(' o ')}.`);
  if (!String(task || '').trim()) throw new Error('Falta "task".');
  if (!model) throw new Error('No hay modelo de programacion resuelto.');

  if (engine === 'aider') {
    return {
      command: env.TERMINAL_CODER_AIDER_CMD || 'aider',
      args: ['--yes-always', '--no-pretty', '--no-stream', '--no-show-release-notes', '--model', `ollama_chat/${model}`, '--message', task],
      env: { OLLAMA_API_BASE: ollamaBase },
    };
  }
  return {
    command: env.TERMINAL_CODER_OPENCODE_CMD || 'opencode',
    args: ['run', '--model', `ollama/${model}`, task],
    env: { OLLAMA_BASE_URL: ollamaBase },
  };
}

function runProcess(command, args, { cwd, env = {}, timeoutMs = 600000, maxBytes = MAX_OUTPUT_BYTES, shell = false, onOutput } = {}) {
  return new Promise((resolve) => {
    let output = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve({ output, truncated, timedOut, ...result });
    };

    let child;
    try {
      child = spawn(command, args, { cwd, env: { ...process.env, ...env }, shell, windowsHide: true });
    } catch (err) {
      return done({ exitCode: null, error: err.message });
    }
    const append = (chunk) => {
      if (output.length >= maxBytes) { truncated = true; return; }
      output += chunk.toString('utf8');
      if (onOutput) onOutput(output.slice(-maxBytes));
      if (output.length > maxBytes) {
        output = output.slice(0, maxBytes);
        truncated = true;
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      const missing = err.code === 'ENOENT' ? `${command} no esta instalado o no esta en PATH.` : err.message;
      done({ exitCode: null, error: missing });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ exitCode: code });
    });
  });
}

async function gitSnapshot(cwd) {
  const head = await runProcess('git', ['rev-parse', 'HEAD'], { cwd, timeoutMs: 15000 });
  return head.exitCode === 0 ? head.output.trim() : null;
}

// `diff` against the pre-run HEAD covers commits (Aider auto-commits) and tracked edits;
// `status` additionally lists untracked files, which `git diff` never shows.
async function gitChanges(cwd, before) {
  const status = await runProcess('git', ['status', '--short'], { cwd, timeoutMs: 15000 });
  const changes = { stat: '', diff: '', status: status.exitCode === 0 ? status.output : '' };
  if (before) {
    changes.stat = (await runProcess('git', ['diff', '--stat', before], { cwd, timeoutMs: 15000 })).output;
    changes.diff = (await runProcess('git', ['diff', before], { cwd, timeoutMs: 15000, maxBytes: 20 * 1024 })).output;
  }
  return changes;
}

let busy = false;

async function runTerminalTask(request, { model, ollamaBase, env = process.env, onProgress } = {}) {
  if (busy) {
    const err = new Error('Ya hay una tarea de terminal en curso. Espera a que termine.');
    err.status = 409;
    throw err;
  }
  const engine = request.engine || env.TERMINAL_CODER_ENGINE || 'aider';
  let testArgs = null;
  if (request.test) {
    const requested = String(request.test).trim();
    if (!allowedTests(env).includes(requested)) {
      const err = new Error(`Comando de test no permitido. Permitidos: ${allowedTests(env).join(' | ')}`);
      err.status = 400;
      throw err;
    }
    testArgs = requested.split(/\s+/);
  }

  const cwd = resolveWorkspace(workspaceRoot(env), request.workspace);
  const spec = buildEngineCommand(engine, { task: request.task, model, ollamaBase }, env);
  const timeoutMs = Number(env.TERMINAL_CODER_TIMEOUT_MS || 600000);

  busy = true;
  try {
    const before = await gitSnapshot(cwd);
    const started = Date.now();
    const run = await runProcess(spec.command, spec.args, { cwd, env: spec.env, timeoutMs, onOutput: onProgress });
    const changes = await gitChanges(cwd, before);

    let tests = null;
    if (testArgs && !run.error) {
      const isWindows = process.platform === 'win32';
      // Safe with shell: the command matched an operator-defined allowlist exactly.
      const result = await runProcess(testArgs[0], testArgs.slice(1), { cwd, timeoutMs: Math.min(timeoutMs, 300000), shell: isWindows });
      tests = { command: request.test.trim(), exitCode: result.exitCode, passed: result.exitCode === 0, output: result.output };
    }

    return {
      ok: !run.error && run.exitCode === 0 && (!tests || tests.passed),
      engine,
      model,
      workspace: cwd,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      truncated: run.truncated,
      error: run.error,
      seconds: Math.round((Date.now() - started) / 1000),
      output: run.output,
      changes,
      tests,
    };
  } finally {
    busy = false;
  }
}

module.exports = {
  ENGINES,
  workspaceRoot,
  resolveWorkspace,
  allowedTests,
  buildEngineCommand,
  runProcess,
  runTerminalTask,
};
