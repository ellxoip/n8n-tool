#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const nodeCmd = process.execPath;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...parts] = trimmed.split('=');
    if (!process.env[key]) process.env[key] = parts.join('=').trim();
  }
}

loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.join(process.cwd(), '.env'));

const n8nBase = process.env.N8N_BASE_URL || 'http://localhost:5678';
const ollamaBase = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(method, rawUrl, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const url = new URL(rawUrl);
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: `${url.pathname}${url.search}`,
      method,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data }));
    });
    req.on('error', (err) => resolve({ ok: false, error: err }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ ok: false, error: new Error(`timeout ${timeoutMs}ms`) });
    });
    req.end();
  });
}

async function isN8nOnline() {
  const res = await request('GET', new URL('/healthz', n8nBase), 3000);
  return res.ok && String(res.data).toLowerCase().includes('ok');
}

async function isOllamaOnline() {
  const res = await request('GET', new URL('/api/tags', ollamaBase), 3000);
  return res.ok;
}

function spawnDetached(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

async function waitFor(label, check, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return true;
    await sleep(1000);
  }
  throw new Error(`${label} no respondio despues de ${Math.round(timeoutMs / 1000)}s`);
}

async function ensureN8n() {
  if (await isN8nOnline()) {
    console.log('n8n: online');
    return;
  }
  console.log('n8n: iniciando...');
  spawnDetached(nodeCmd, [path.join(root, 'scripts', 'start-n8n.js')]);
  await waitFor('n8n', isN8nOnline, Number(process.env.N8N_TOOL_START_TIMEOUT_MS || 60000));
  console.log('n8n: online');
}

async function ensureOllama() {
  if (await isOllamaOnline()) {
    console.log('Ollama: online');
    return;
  }

  const command = isWindows ? 'ollama.exe' : 'ollama';
  try {
    console.log('Ollama: iniciando...');
    spawnDetached(command, ['serve']);
    await waitFor('Ollama', isOllamaOnline, 30000);
    console.log('Ollama: online');
  } catch (err) {
    throw new Error(`Ollama offline. Inicia Ollama manualmente o instala ollama en PATH. Detalle: ${err.message}`);
  }
}

function runNode(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeCmd, [path.join(root, script), ...args], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} salio con codigo ${code}`));
    });
  });
}

async function syncWorkflows() {
  if (!process.env.N8N_API_KEY) {
    console.log('Workflows: salto sync, falta N8N_API_KEY en .env');
    return;
  }
  console.log('Workflows: asegurando credencial Ollama...');
  await runNode('scripts/n8n-admin.js', ['ensure-ollama']);
  console.log('Workflows: importando/actualizando...');
  await runNode('scripts/n8n-admin.js', ['upsert']);
  console.log('Workflows: activando...');
  await runNode('scripts/n8n-admin.js', ['activate']);
}

async function main() {
  const args = process.argv.slice(2);
  const passthrough = ['--doctor', '--status', '--list', '--test', '--help', '-h'];

  await ensureN8n();
  await ensureOllama();

  if (!args.includes('--no-sync')) {
    try {
      await syncWorkflows();
    } catch (err) {
      console.error(`Workflows: ${err.message}`);
      console.error('Corrige N8N_API_KEY o ejecuta con --no-sync para abrir el chat sin sincronizar.');
      process.exit(1);
    }
  }

  const cleanArgs = args.filter((arg) => arg !== '--no-sync');
  if (cleanArgs.length === 0 || passthrough.some((arg) => cleanArgs.includes(arg))) {
    await runNode('ai-team.js', cleanArgs);
    return;
  }

  await runNode('ai-team.js', ['--agent', '0', cleanArgs.join(' ')]);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
