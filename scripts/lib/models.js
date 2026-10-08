const fs = require('fs');
const path = require('path');
const { root, getOllamaModels } = require('./common');

const CONFIG_FILE = path.join(root, 'config', 'models.json');

function loadModelConfig(file = CONFIG_FILE) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!config.roles || typeof config.roles !== 'object') {
    throw new Error(`${file}: falta la seccion "roles".`);
  }
  for (const [role, spec] of Object.entries(config.roles)) {
    if (!spec.preferred) throw new Error(`${file}: el rol "${role}" no tiene "preferred".`);
  }
  return config;
}

function envOverrideName(role) {
  return `OLLAMA_MODEL_${role.toUpperCase()}`;
}

// "qwen3:4b" and "mistral-small" (== "mistral-small:latest") must compare correctly.
function normalizeModel(name) {
  const trimmed = String(name || '').trim();
  return trimmed.includes(':') ? trimmed : `${trimmed}:latest`;
}

function sameModel(a, b) {
  return normalizeModel(a) === normalizeModel(b);
}

function candidatesFor(role, config, env = process.env) {
  const spec = config.roles[role];
  if (!spec) throw new Error(`Rol de modelo desconocido: ${role}`);
  const list = [env[envOverrideName(role)], spec.preferred, ...(spec.fallbacks || [])]
    .filter(Boolean)
    .map((name) => name.trim());
  return list.filter((name, i) => list.findIndex((other) => sameModel(other, name)) === i);
}

/**
 * Picks the first candidate that is installed. When Ollama is unreachable
 * (installed is empty) the preferred candidate is returned unverified.
 */
function resolveRole(role, installed, config, env = process.env) {
  const candidates = candidatesFor(role, config, env);
  const spec = config.roles[role];
  const preferred = candidates[0];
  const found = candidates.find((name) => installed.some((have) => sameModel(have, name)));
  return {
    role,
    label: spec.label || role,
    required: spec.required !== false,
    numCtx: spec.numCtx,
    candidates,
    preferred,
    selected: found || preferred,
    installed: Boolean(found),
    usingFallback: Boolean(found) && !sameModel(found, preferred),
    verified: installed.length > 0,
  };
}

function resolveAll(installed, config, env = process.env) {
  const result = {};
  for (const role of Object.keys(config.roles)) {
    result[role] = resolveRole(role, installed, config, env);
  }
  return result;
}

// Resolves a role against what Ollama currently has installed.
async function selectedModel(role, config = loadModelConfig()) {
  const installed = await getOllamaModels();
  return resolveRole(role, installed, config).selected;
}

module.exports = {
  selectedModel,
  CONFIG_FILE,
  loadModelConfig,
  envOverrideName,
  normalizeModel,
  sameModel,
  candidatesFor,
  resolveRole,
  resolveAll,
};
