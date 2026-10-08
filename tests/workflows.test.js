const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { loadModelConfig, resolveRole } = require('../scripts/lib/models');
const { patchWorkflow, findRemote, triggerKeys } = require('../scripts/lib/workflow-patch');

const dir = path.join(__dirname, '..', 'workflows');
const config = loadModelConfig();
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const load = (file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

test('config/models.json declares exactly the workflow files on disk', () => {
  assert.deepEqual(Object.keys(config.workflows).sort(), files);
  for (const [file, entry] of Object.entries(config.workflows)) {
    if (entry.role) assert.ok(config.roles[entry.role], `${file}: rol ${entry.role}`);
  }
});

for (const file of files) {
  test(`${file}: structure is valid`, () => {
    const wf = load(file);
    const names = wf.nodes.map((n) => n.name);
    assert.equal(new Set(names).size, names.length, 'nombres de nodo unicos');
    assert.equal(new Set(wf.nodes.map((n) => n.id)).size, wf.nodes.length, 'ids de nodo unicos');

    for (const [from, outputs] of Object.entries(wf.connections)) {
      assert.ok(names.includes(from), `conexion desde nodo inexistente: ${from}`);
      for (const branch of Object.values(outputs)) {
        for (const list of branch) {
          for (const target of list) assert.ok(names.includes(target.node), `${from} -> ${target.node} no existe`);
        }
      }
    }
  });

  test(`${file}: HTTP tools have a description and a valid tool name`, () => {
    for (const node of load(file).nodes.filter((n) => n.type.endsWith('toolHttpRequest'))) {
      assert.ok(node.parameters.toolDescription, `${node.name}: falta toolDescription`);
      assert.match(node.name, TOOL_NAME, `${node.name}: nombre de tool invalido`);
      for (const p of node.parameters.placeholderDefinitions?.values || []) {
        assert.ok(p.description, `${node.name}.${p.name}: placeholder sin descripcion`);
      }
    }
  });

  test(`${file}: no secrets or fixed tokens`, () => {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.doesNotMatch(text, /Bearer\s+[A-Za-z0-9]{16,}/);
    assert.doesNotMatch(text, /sk-[A-Za-z0-9]{20,}/);
  });
}

test('Ollama nodes default to the preferred model of their role', () => {
  for (const [file, entry] of Object.entries(config.workflows)) {
    if (!entry.role) continue;
    const preferred = config.roles[entry.role].preferred;
    for (const node of load(file).nodes.filter((n) => n.type.endsWith('lmChatOllama'))) {
      assert.equal(node.parameters.model, preferred, `${file}: ${node.name}`);
    }
  }
});

test('webhook identifiers are unique across workflows', () => {
  const keys = files.flatMap((f) => triggerKeys(load(f)));
  assert.equal(new Set(keys).size, keys.length);
});

test('supervisor delegates to every chat agent', () => {
  const supervisor = load('supervisor.json');
  const urls = supervisor.nodes.map((n) => n.parameters.url).filter(Boolean).join('\n');
  for (const file of files.filter((f) => f !== 'supervisor.json')) {
    for (const node of load(file).nodes.filter((n) => n.type.endsWith('chatTrigger'))) {
      if (node.webhookId === 'agente-multi-trabajador') continue;
      assert.ok(urls.includes(`/webhook/${node.webhookId}/chat`), `supervisor no delega a ${node.webhookId}`);
    }
  }
});

test('patchWorkflow adapts models, context, credentials and URLs', () => {
  const wf = load('agente_analista.json');
  const roleInfo = resolveRole('analyst', ['deepseek-r1:14b'], config, {});
  patchWorkflow(wf, {
    roleInfo,
    env: { BRIDGE_PORT: '9999' },
    ollamaCredential: { id: 'cred1', name: 'Ollama Local' },
    bridgeCredential: { id: 'cred2', name: 'Bridge Token' },
  });
  const model = wf.nodes.find((n) => n.type.endsWith('lmChatOllama'));
  assert.equal(model.parameters.model, 'deepseek-r1:14b');
  assert.equal(model.parameters.options.numCtx, config.roles.analyst.numCtx);
  assert.deepEqual(model.credentials.ollamaApi, { id: 'cred1', name: 'Ollama Local' });
  const memory = wf.nodes.find((n) => n.name === 'buscar_memoria');
  assert.deepEqual(memory.credentials.httpHeaderAuth, { id: 'cred2', name: 'Bridge Token' });
  assert.equal(memory.parameters.url, 'http://127.0.0.1:9999/memory/search');
});

test('patchWorkflow fills Set nodes from env without touching expressions', () => {
  const wf = load('voz_agente.json');
  patchWorkflow(wf, {
    roleInfo: resolveRole('supervisor', ['qwen3:4b'], config, {}),
    env: { OLLAMA_BASE_URL: 'http://localhost:11434', TTS_BASE_URL: 'http://localhost:5005', TTS_VOICE: 'miVoz' },
  });
  const values = Object.fromEntries(
    wf.nodes.find((n) => n.name === 'Config Voz').parameters.assignments.assignments.map((a) => [a.name, a.value]),
  );
  assert.equal(values.llm_model, 'qwen3:4b');
  assert.equal(values.ollama_url, 'http://127.0.0.1:11434');
  assert.equal(values.tts_url, 'http://127.0.0.1:5005');
  assert.equal(values.tts_voice, 'miVoz');
  assert.equal(values.stt_model, 'Systran/faster-whisper-small');

  const direct = wf.nodes.find((n) => n.name === 'Texto Directo').parameters.assignments.assignments[0];
  assert.ok(direct.value.startsWith('='));
});

test('findRemote matches renamed workflows by their webhook', () => {
  const local = load('agente_analista.json');
  const renamedRemote = { id: '1', name: '🧠 Agente Analista (deepseek-r1)', nodes: [{ type: '@n8n/n8n-nodes-langchain.chatTrigger', webhookId: 'agente-analista' }] };
  const other = { id: '2', name: 'Otro', nodes: [] };
  assert.equal(findRemote(local, [other, renamedRemote]).id, '1');
  assert.equal(findRemote(local, [other]), undefined);
  assert.equal(findRemote(local, [{ id: '3', name: local.name, nodes: [] }, renamedRemote]).id, '3');
});
