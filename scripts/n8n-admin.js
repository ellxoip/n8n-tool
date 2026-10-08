#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { root, loadEnv, getOllamaModels } = require('./lib/common');
const { loadModelConfig, resolveAll } = require('./lib/models');
const { patchWorkflow, findRemote } = require('./lib/workflow-patch');

loadEnv();

const baseUrl = process.env.N8N_BASE_URL || 'http://localhost:5678';
const apiKey = process.env.N8N_API_KEY;
const apiBase = `${baseUrl.replace(/\/$/, '')}/api/v1`;
const ollamaCredentialName = process.env.OLLAMA_CREDENTIAL_NAME || 'Ollama Local';
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const bridgeCredentialName = 'Bridge Token';

function usage() {
  console.log(`Uso:
  node scripts/n8n-admin.js list
  node scripts/n8n-admin.js import
  node scripts/n8n-admin.js activate
  node scripts/n8n-admin.js deactivate
  node scripts/n8n-admin.js upsert
  node scripts/n8n-admin.js ensure-ollama
  node scripts/n8n-admin.js ensure-bridge [--force]

Requiere N8N_API_KEY en .env para hablar con la API de n8n.
"upsert" e "import" adaptan cada workflow a tu maquina: modelos instalados
(config/models.json), credenciales y URLs de servicios.`);
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

async function listRemoteWorkflows() {
  const result = await n8n('GET', '/workflows?limit=250');
  return Array.isArray(result.data) ? result.data : result;
}

async function listRemote() {
  for (const workflow of await listRemoteWorkflows()) {
    console.log(`${workflow.id}\t${workflow.active ? 'active' : 'inactive'}\t${workflow.name}`);
  }
}

async function findCredential(name, type) {
  const result = await n8n('GET', '/credentials');
  const credentials = Array.isArray(result.data) ? result.data : result;
  return credentials.find((credential) => credential.name === name && credential.type === type);
}

async function ensureOllamaCredential() {
  const existing = await findCredential(ollamaCredentialName, 'ollamaApi');
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

// Header-auth credential used by the agents to call the local bridge without
// ever putting the token inside a workflow file.
async function ensureBridgeCredential({ force = false } = {}) {
  const token = process.env.BRIDGE_TOKEN;
  if (!token) {
    console.log('Credencial Bridge: salto, falta BRIDGE_TOKEN en .env (n8n-tool lo genera solo).');
    return null;
  }
  const existing = await findCredential(bridgeCredentialName, 'httpHeaderAuth');
  if (existing && !force) {
    console.log(`Credencial Bridge existente: ${existing.name} (usa --force si rotaste BRIDGE_TOKEN)`);
    return existing;
  }
  if (existing) {
    console.log(`Recreando credencial Bridge: ${bridgeCredentialName}`);
    await n8n('DELETE', `/credentials/${existing.id}`);
  } else {
    console.log(`Creando credencial Bridge: ${bridgeCredentialName}`);
  }
  return n8n('POST', '/credentials', {
    name: bridgeCredentialName,
    type: 'httpHeaderAuth',
    data: { name: 'Authorization', value: `Bearer ${token}` },
  });
}

async function buildPatchContext() {
  const config = loadModelConfig();
  const installed = await getOllamaModels();
  const resolved = resolveAll(installed, config);
  const ollamaCredential = await ensureOllamaCredential();
  const bridgeCredential = await ensureBridgeCredential();

  if (!installed.length) {
    console.log('Aviso: Ollama no responde; uso los modelos preferidos sin verificar instalacion.');
  }
  for (const info of Object.values(resolved)) {
    if (info.verified && !info.installed && info.required) {
      console.log(`Aviso: falta el modelo del rol ${info.role}: ejecuta "ollama pull ${info.preferred}" (o define OLLAMA_MODEL_${info.role.toUpperCase()}).`);
    }
  }
  return { config, resolved, ollamaCredential, bridgeCredential };
}

function patchedWorkflow(file, context) {
  const workflow = loadWorkflow(file);
  const entry = context.config.workflows?.[path.basename(file)] || {};
  return patchWorkflow(workflow, {
    roleInfo: entry.role ? context.resolved[entry.role] : undefined,
    env: process.env,
    ollamaCredential: context.ollamaCredential,
    bridgeCredential: context.bridgeCredential,
  });
}

async function importAll({ updateExisting }) {
  const context = await buildPatchContext();
  const remotes = await listRemoteWorkflows();
  for (const file of workflowFiles()) {
    const workflow = patchedWorkflow(file, context);
    const remote = updateExisting ? findRemote(workflow, remotes) : undefined;
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
  const remotes = await listRemoteWorkflows();
  for (const file of workflowFiles()) {
    const workflow = loadWorkflow(file);
    const remote = findRemote(workflow, remotes);
    if (!remote) {
      console.log(`No existe remoto: ${workflow.name}`);
      continue;
    }
    if (Boolean(remote.active) === active) {
      console.log(`${active ? 'Activo' : 'Inactivo'} ya: ${workflow.name}`);
      continue;
    }
    console.log(`${active ? 'Activando' : 'Desactivando'}: ${workflow.name}`);
    try {
      await n8n('POST', `/workflows/${remote.id}/${active ? 'activate' : 'deactivate'}`);
    } catch (err) {
      // One broken workflow must not leave the rest of the team inactive.
      console.error(`  No pude ${active ? 'activar' : 'desactivar'} ${workflow.name}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd || process.argv.includes('--help') || process.argv.includes('-h')) return usage();
  if (cmd === 'list') return listRemote();
  if (cmd === 'ensure-ollama') return ensureOllamaCredential();
  if (cmd === 'ensure-bridge') return ensureBridgeCredential({ force: process.argv.includes('--force') });
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
