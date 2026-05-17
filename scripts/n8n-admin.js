#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

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

const baseUrl = process.env.N8N_BASE_URL || 'http://localhost:5678';
const apiKey = process.env.N8N_API_KEY;
const apiBase = `${baseUrl.replace(/\/$/, '')}/api/v1`;
const ollamaCredentialName = process.env.OLLAMA_CREDENTIAL_NAME || 'Ollama Local';
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

function usage() {
  console.log(`Uso:
  node scripts/n8n-admin.js list
  node scripts/n8n-admin.js import
  node scripts/n8n-admin.js activate
  node scripts/n8n-admin.js deactivate
  node scripts/n8n-admin.js upsert
  node scripts/n8n-admin.js ensure-ollama

Requiere N8N_API_KEY en .env para hablar con la API de n8n.`);
}

async function n8n(method, endpoint, body) {
  if (!apiKey) throw new Error('Falta N8N_API_KEY en .env o variable de entorno.');
  const res = await fetch(`${apiBase}${endpoint}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`${method} ${endpoint} fallo HTTP ${res.status}: ${detail.slice(0, 500)}`);
  }
  return data;
}

function workflowFiles() {
  const dir = path.join(root, 'workflows');
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => path.join(dir, file));
}

function loadWorkflow(file) {
  const workflow = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete workflow.id;
  delete workflow.active;
  delete workflow.versionId;
  delete workflow.createdAt;
  delete workflow.updatedAt;
  return workflow;
}

function patchOllamaCredentials(workflow, credential) {
  if (!credential) return workflow;
  for (const node of workflow.nodes || []) {
    if (!node.credentials || !node.credentials.ollamaApi) continue;
    node.credentials.ollamaApi = {
      id: credential.id,
      name: credential.name,
    };
  }
  return workflow;
}

async function listRemote() {
  const result = await n8n('GET', '/workflows');
  const workflows = Array.isArray(result.data) ? result.data : result;
  for (const workflow of workflows) {
    console.log(`${workflow.id}\t${workflow.active ? 'active' : 'inactive'}\t${workflow.name}`);
  }
}

async function getRemoteByName() {
  const result = await n8n('GET', '/workflows');
  const workflows = Array.isArray(result.data) ? result.data : result;
  const map = new Map();
  for (const workflow of workflows) map.set(workflow.name, workflow);
  return map;
}

async function ensureOllamaCredential() {
  const result = await n8n('GET', '/credentials');
  const credentials = Array.isArray(result.data) ? result.data : result;
  const existing = credentials.find((credential) =>
    credential.name === ollamaCredentialName && credential.type === 'ollamaApi');

  if (existing) {
    console.log(`Credencial Ollama existente: ${existing.name}`);
    return existing;
  }

  console.log(`Creando credencial Ollama: ${ollamaCredentialName}`);
  return n8n('POST', '/credentials', {
    name: ollamaCredentialName,
    type: 'ollamaApi',
    data: {
      baseUrl: ollamaBaseUrl,
    },
  });
}

async function importAll({ updateExisting }) {
  const ollamaCredential = await ensureOllamaCredential();
  const existing = updateExisting ? await getRemoteByName() : new Map();
  for (const file of workflowFiles()) {
    const workflow = patchOllamaCredentials(loadWorkflow(file), ollamaCredential);
    const remote = existing.get(workflow.name);
    if (remote) {
      console.log(`Actualizando: ${workflow.name}`);
      await n8n('PUT', `/workflows/${remote.id}`, workflow);
    } else {
      console.log(`Importando: ${workflow.name}`);
      await n8n('POST', '/workflows', workflow);
    }
  }
}

async function setActive(active) {
  const existing = await getRemoteByName();
  for (const file of workflowFiles()) {
    const workflow = loadWorkflow(file);
    const remote = existing.get(workflow.name);
    if (!remote) {
      console.log(`No existe remoto: ${workflow.name}`);
      continue;
    }
    if (Boolean(remote.active) === active) {
      console.log(`${active ? 'Activo' : 'Inactivo'} ya: ${workflow.name}`);
      continue;
    }
    console.log(`${active ? 'Activando' : 'Desactivando'}: ${workflow.name}`);
    await n8n('POST', `/workflows/${remote.id}/${active ? 'activate' : 'deactivate'}`);
  }
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd || process.argv.includes('--help') || process.argv.includes('-h')) return usage();
  if (cmd === 'list') return listRemote();
  if (cmd === 'ensure-ollama') return ensureOllamaCredential();
  if (cmd === 'import') return importAll({ updateExisting: false });
  if (cmd === 'upsert' || cmd === 'update') return importAll({ updateExisting: true });
  if (cmd === 'activate') return setActive(true);
  if (cmd === 'deactivate') return setActive(false);
  throw new Error(`Comando no soportado: ${cmd}`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
