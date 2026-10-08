// Pure helpers that adapt the versioned workflow JSON files to the local machine
// (resolved models, credentials, service URLs) right before they are sent to n8n.

const VALUE_ENV = {
  stt_url: 'STT_BASE_URL',
  stt_model: 'STT_MODEL',
  tts_url: 'TTS_BASE_URL',
  tts_model: 'TTS_MODEL',
  tts_voice: 'TTS_VOICE',
  tts_format: 'TTS_FORMAT',
};

// n8n on Windows often resolves "localhost" to ::1 while Ollama listens on IPv4 only.
function ipv4(url) {
  return String(url).replace(/\/$/, '').replace('//localhost', '//127.0.0.1');
}

function isExpression(value) {
  return typeof value === 'string' && value.startsWith('=');
}

function setValues(roleInfo, env) {
  const values = {};
  if (roleInfo) {
    values.model = roleInfo.selected;
    values.llm_model = roleInfo.selected;
  }
  if (env.OLLAMA_BASE_URL) values.ollama_url = ipv4(env.OLLAMA_BASE_URL);
  for (const [field, envName] of Object.entries(VALUE_ENV)) {
    if (env[envName]) values[field] = field.endsWith('_url') ? ipv4(env[envName]) : env[envName];
  }
  return values;
}

function replaceInStrings(node, replacements) {
  const walk = (value) => {
    if (typeof value === 'string') {
      return replacements.reduce((text, [from, to]) => (from === to ? text : text.split(from).join(to)), value);
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };
  node.parameters = walk(node.parameters);
}

/**
 * @param workflow  parsed workflow JSON (mutated and returned)
 * @param ctx.roleInfo          resolved role for this workflow (see models.resolveRole) or undefined
 * @param ctx.env               process.env-like object
 * @param ctx.ollamaCredential  { id, name } for Ollama nodes
 * @param ctx.bridgeCredential  { id, name } for the "Bridge Token" header auth credential
 */
function patchWorkflow(workflow, ctx) {
  const { roleInfo, env = {}, ollamaCredential, bridgeCredential } = ctx;
  const values = setValues(roleInfo, env);
  const bridgeUrl = ipv4(env.BRIDGE_URL || `http://127.0.0.1:${env.BRIDGE_PORT || 8787}`);
  const n8nUrl = ipv4(env.N8N_BASE_URL || 'http://127.0.0.1:5678');
  const replacements = [
    ['http://127.0.0.1:8787', bridgeUrl],
    ['http://127.0.0.1:5678', n8nUrl],
  ];

  for (const node of workflow.nodes || []) {
    if (node.type === '@n8n/n8n-nodes-langchain.lmChatOllama' && roleInfo) {
      node.parameters.model = roleInfo.selected;
      if (roleInfo.numCtx) node.parameters.options = { ...node.parameters.options, numCtx: roleInfo.numCtx };
    }

    if (node.type === 'n8n-nodes-base.set') {
      for (const assignment of node.parameters?.assignments?.assignments || []) {
        if (assignment.name in values && !isExpression(assignment.value)) {
          assignment.value = values[assignment.name];
        }
      }
    }

    if (node.credentials?.ollamaApi && ollamaCredential) {
      node.credentials.ollamaApi = { id: ollamaCredential.id, name: ollamaCredential.name };
    }
    if (node.credentials?.httpHeaderAuth && bridgeCredential) {
      node.credentials.httpHeaderAuth = { id: bridgeCredential.id, name: bridgeCredential.name };
    }

    replaceInStrings(node, replacements);
  }
  return workflow;
}

// Keys that identify a workflow by its public entry points, so a renamed workflow
// is still matched with the one already imported in n8n.
function triggerKeys(workflow) {
  const keys = [];
  for (const node of workflow.nodes || []) {
    if (node.type === '@n8n/n8n-nodes-langchain.chatTrigger' && node.webhookId) keys.push(`chat:${node.webhookId}`);
    if (node.type === 'n8n-nodes-base.webhook' && node.parameters?.path) keys.push(`hook:${node.parameters.path}`);
  }
  return keys;
}

function findRemote(workflow, remotes) {
  const byName = remotes.find((remote) => remote.name === workflow.name);
  if (byName) return byName;
  const wanted = triggerKeys(workflow);
  if (!wanted.length) return undefined;
  return remotes.find((remote) => triggerKeys(remote).some((key) => wanted.includes(key)));
}

module.exports = { patchWorkflow, triggerKeys, findRemote, ipv4 };
