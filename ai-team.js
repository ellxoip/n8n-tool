#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const {
  loadEnv, requestRaw, requestJson, isServiceUp, getOllamaModels,
} = require('./scripts/lib/common');
const { loadModelConfig, resolveAll, envOverrideName } = require('./scripts/lib/models');
const memory = require('./scripts/lib/memory');

loadEnv();

const N8N_BASE = process.env.N8N_BASE_URL || 'http://localhost:5678';
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

const AGENTS = [
  {
    id: 0,
    name: 'Supervisor',
    role: 'supervisor',
    webhook: '/webhook/agente-supervisor/chat',
    description: 'Orquesta el equipo y enruta tareas.',
    color: '\x1b[31m',
  },
  {
    id: 1,
    name: 'Analista',
    role: 'analyst',
    webhook: '/webhook/agente-analista/chat',
    description: 'Descubre requisitos, riesgos y arquitectura.',
    color: '\x1b[35m',
  },
  {
    id: 2,
    name: 'Programador',
    role: 'programmer',
    webhook: '/webhook/agente-programador/chat',
    description: 'Disena e implementa codigo en la conversacion.',
    color: '\x1b[32m',
  },
  {
    id: 3,
    name: 'Revisor QA',
    role: 'reviewer',
    webhook: '/webhook/agente-revisor/chat',
    description: 'Revisa bugs, seguridad y pruebas.',
    color: '\x1b[33m',
  },
  {
    id: 4,
    name: 'DevOps Runtime',
    role: 'devops',
    webhook: '/webhook/agente-devops/chat',
    description: 'Valida runtime, logs, health checks y despliegue local.',
    color: '\x1b[36m',
  },
  {
    id: 5,
    name: 'Terminal Coder',
    role: 'programmer',
    webhook: '/webhook/agente-terminal-coder/chat',
    description: 'Edita archivos reales y corre tests con Aider/OpenCode.',
    color: '\x1b[94m',
  },
];

const ENDPOINTS = {
  ocr: '/webhook/ocr-vision',
  tts: '/webhook/voz-tts',
  voice: '/webhook/voz-agente',
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

const agentTimeoutMs = () => Number(process.env.N8N_TEAM_TIMEOUT_MS || 300000);

async function resolveModels() {
  const installed = await getOllamaModels();
  return { installed, resolved: resolveAll(installed, loadModelConfig()) };
}

async function sendToAgent(agent, message, sessionId) {
  const res = await requestJson('POST', new URL(agent.webhook, N8N_BASE), {
    action: 'sendMessage',
    chatInput: message,
    sessionId,
  }, agentTimeoutMs());

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`n8n respondio HTTP ${res.status}: ${String(res.data).slice(0, 200)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(res.data);
  } catch {
    return res.data;
  }

  return parsed.output ||
    parsed.text ||
    parsed.response ||
    (parsed.data && parsed.data[0] && parsed.data[0].output) ||
    (Array.isArray(parsed) && parsed[0] && (parsed[0].output || parsed[0].text)) ||
    JSON.stringify(parsed, null, 2);
}

async function checkN8nHealth() {
  try {
    const res = await requestJson('GET', new URL('/healthz', N8N_BASE), null, 3000);
    return res.status === 200 && res.data.toLowerCase().includes('ok');
  } catch {
    return false;
  }
}

function printBanner() {
  console.log(`${BOLD}${CYAN}n8n AI Team CLI${RESET}`);
}

async function printAgentList() {
  const { resolved } = await resolveModels();
  console.log(`${BOLD}Agentes:${RESET}`);
  for (const agent of AGENTS) {
    console.log(`  ${agent.color}[${agent.id}] ${agent.name}${RESET} ${DIM}${resolved[agent.role].selected}${RESET}`);
    console.log(`      ${agent.description}`);
  }
}

async function printStatus() {
  const n8nOk = await checkN8nHealth();
  const models = await getOllamaModels();
  console.log(`${BOLD}Estado:${RESET}`);
  console.log(`  n8n:    ${n8nOk ? `${GREEN}online` : `${RED}offline`}${RESET} ${N8N_BASE}`);
  console.log(`  Ollama: ${models.length ? `${GREEN}online` : `${RED}offline`}${RESET} ${OLLAMA_BASE}`);
  if (models.length) {
    console.log('  Modelos:');
    for (const model of models) console.log(`    - ${model}`);
  }
}

async function printModels() {
  const { installed, resolved } = await resolveModels();
  console.log(`${BOLD}Modelos por rol${RESET} ${DIM}(config/models.json)${RESET}`);
  if (!installed.length) console.log(`  ${YELLOW}Ollama offline: se muestran los modelos preferidos sin verificar.${RESET}`);
  for (const info of Object.values(resolved)) {
    let state;
    if (!info.verified) state = `${DIM}sin verificar${RESET}`;
    else if (!info.installed) state = `${YELLOW}faltante${RESET} -> ollama pull ${info.preferred}`;
    else if (info.usingFallback) state = `${YELLOW}fallback${RESET} (preferido: ${info.preferred})`;
    else state = `${GREEN}ok${RESET}`;
    console.log(`  ${info.role.padEnd(11)} ${info.selected.padEnd(26)} ${state}`);
  }
  console.log(`${DIM}  Cambia un rol sin editar archivos: ${envOverrideName('analyst')}=otro-modelo:tag en .env${RESET}`);
}

function runInherit(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', (err) => {
      console.log(`${RED}No pude ejecutar ${command}: ${err.message}${RESET}`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code));
  });
}

async function pullModels(includeOptional) {
  const { installed, resolved } = await resolveModels();
  if (!installed.length) throw new Error('Ollama no responde; inicialo antes de descargar modelos.');
  const wanted = [...new Set(Object.values(resolved)
    .filter((info) => !info.installed && (info.required || includeOptional))
    .map((info) => info.preferred))];
  if (!wanted.length) {
    console.log(`${GREEN}Todos los modelos necesarios ya estan instalados.${RESET}`);
    return;
  }
  let failed = 0;
  for (const model of wanted) {
    console.log(`${BOLD}ollama pull ${model}${RESET}`);
    if (await runInherit(process.platform === 'win32' ? 'ollama.exe' : 'ollama', ['pull', model]) !== 0) {
      failed += 1;
      console.log(`${YELLOW}Fallo ${model}: verifica el tag en https://ollama.com/library o define ${envOverrideName('<rol>')} en .env. Sigo con el siguiente.${RESET}`);
    }
  }
  process.exitCode = failed ? 1 : 0;
}

const SERVICES = [
  { name: 'Bridge (terminal coder + memoria)', url: () => `http://127.0.0.1:${process.env.BRIDGE_PORT || 8787}/health`, hint: 'n8n-tool lo inicia solo, o: npm run bridge' },
  { name: 'Qdrant (memoria RAG)', url: () => `${process.env.QDRANT_URL || 'http://127.0.0.1:6333'}/healthz`, hint: 'docker compose up -d qdrant' },
  { name: 'TTS (sintetizador de voz)', url: () => process.env.TTS_BASE_URL || 'http://127.0.0.1:8880', hint: 'docker compose --profile voice up -d' },
  { name: 'STT (Whisper)', url: () => process.env.STT_BASE_URL || 'http://127.0.0.1:8000', hint: 'docker compose --profile voice up -d' },
];

async function doctor() {
  let failures = 0;
  const n8nOk = await checkN8nHealth();
  const { installed, resolved } = await resolveModels();
  const config = loadModelConfig();
  const workflowDir = path.join(__dirname, 'workflows');
  const workflowFiles = fs.existsSync(workflowDir)
    ? fs.readdirSync(workflowDir).filter((f) => f.endsWith('.json')).sort()
    : [];

  console.log(`${BOLD}Doctor n8n AI Team${RESET}`);
  console.log(`  Node: ${process.version}`);
  console.log(`  n8n: ${n8nOk ? `${GREEN}ok` : `${RED}offline`}${RESET}`);
  if (!n8nOk) failures += 1;
  console.log(`  Ollama: ${installed.length ? `${GREEN}ok` : `${RED}offline`}${RESET}`);
  if (!installed.length) failures += 1;

  console.log('  Modelos por rol:');
  for (const info of Object.values(resolved)) {
    let state;
    if (!info.verified) state = `${DIM}sin verificar${RESET}`;
    else if (info.installed && info.usingFallback) state = `${YELLOW}fallback${RESET} (preferido ${info.preferred})`;
    else if (info.installed) state = `${GREEN}ok${RESET}`;
    else state = `${info.required ? YELLOW : DIM}${info.required ? 'faltante' : 'opcional, no instalado'}${RESET} -> ollama pull ${info.preferred}`;
    console.log(`    ${info.role.padEnd(11)} ${info.selected} ${state}`);
  }

  console.log(`  Workflows locales: ${workflowFiles.length}`);
  for (const file of workflowFiles) {
    try {
      JSON.parse(fs.readFileSync(path.join(workflowDir, file), 'utf8'));
      console.log(`    ${GREEN}ok${RESET} ${file}`);
    } catch (err) {
      failures += 1;
      console.log(`    ${RED}json invalido${RESET} ${file}: ${err.message}`);
    }
  }
  for (const file of Object.keys(config.workflows || {})) {
    if (!workflowFiles.includes(file)) {
      failures += 1;
      console.log(`    ${RED}falta${RESET} ${file} (declarado en config/models.json)`);
    }
  }

  console.log('  Servicios opcionales:');
  for (const service of SERVICES) {
    const up = await isServiceUp(service.url());
    console.log(`    ${service.name}: ${up ? `${GREEN}online` : `${YELLOW}offline`}${RESET}${up ? '' : ` ${DIM}(${service.hint})${RESET}`}`);
  }

  console.log(`  N8N_API_KEY: ${process.env.N8N_API_KEY ? `${GREEN}configurada` : `${YELLOW}no configurada${RESET} (solo necesaria para importar/activar)`}${RESET}`);
  console.log(`  BRIDGE_TOKEN: ${process.env.BRIDGE_TOKEN ? `${GREEN}configurado` : `${YELLOW}no configurado${RESET} (n8n-tool lo genera)`}${RESET}`);

  process.exitCode = failures ? 1 : 0;
}

async function testAllAgents() {
  for (const agent of AGENTS) {
    process.stdout.write(`${agent.name}: `);
    try {
      const response = await sendToAgent(agent, 'Responde solo OK si funcionas.', `test-${Date.now()}`);
      console.log(`${GREEN}ok${RESET} ${String(response).slice(0, 100).replace(/\s+/g, ' ')}`);
    } catch (err) {
      console.log(`${RED}error${RESET} ${err.message}`);
    }
  }
}

// ---------- multimodal commands ----------

// Extracts "--name value" from args (mutating), returns the value or undefined.
function takeOption(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, value === undefined ? 1 : 2);
  return value;
}

function afterFlag(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? [] : args.slice(i + 1);
}

async function postToN8n(endpoint, body, { raw = false, headers = {} } = {}) {
  const payload = Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const res = await requestRaw('POST', new URL(endpoint, N8N_BASE), payload, agentTimeoutMs(), {
    'Content-Type': 'application/json',
    ...headers,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`n8n respondio HTTP ${res.status} en ${endpoint}: ${res.buffer.toString('utf8').slice(0, 300)}. Importa y activa los workflows con n8n-tool.`);
  }
  return raw ? res : JSON.parse(res.buffer.toString('utf8'));
}

function audioExtension(contentType = '') {
  if (contentType.includes('wav')) return 'wav';
  if (contentType.includes('ogg')) return 'ogg';
  if (contentType.includes('flac')) return 'flac';
  if (contentType.includes('opus')) return 'opus';
  return 'mp3';
}

function saveAudio(res, out) {
  const target = out || `audio-${Date.now()}.${audioExtension(res.headers['content-type'])}`;
  fs.writeFileSync(target, res.buffer);
  return path.resolve(target);
}

async function runOcr(args) {
  const mode = takeOption(args, '--mode') || 'documento';
  const asJson = args.includes('--json');
  const [file, ...promptParts] = args.filter((arg) => arg !== '--json');
  if (!file) throw new Error('Uso: --ocr <imagen> [--mode texto|documento|salud] [--json] [prompt]');
  if (!fs.existsSync(file)) throw new Error(`No existe la imagen: ${file}`);

  const result = await postToN8n(ENDPOINTS.ocr, {
    image_base64: fs.readFileSync(file).toString('base64'),
    mode,
    prompt: promptParts.join(' ') || undefined,
  });
  if (asJson || mode === 'texto') {
    console.log(asJson ? JSON.stringify(result, null, 2) : result.text);
    return;
  }
  console.log(JSON.stringify(result.fields || { texto: result.text }, null, 2));
}

async function runTts(args) {
  const out = takeOption(args, '--out');
  const voice = takeOption(args, '--voice-name');
  const text = args.join(' ').trim();
  if (!text) throw new Error('Uso: --tts "texto" [--out archivo.mp3] [--voice-name voz]');
  const res = await postToN8n(ENDPOINTS.tts, { text, voice }, { raw: true });
  console.log(`Audio guardado en ${saveAudio(res, out)}`);
}

function multipartBody(boundary, filename, content) {
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(filename)}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  return Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)]);
}

async function runVoice(args) {
  const out = takeOption(args, '--out');
  const input = args.join(' ').trim();
  if (!input) throw new Error('Uso: --voice <audio.wav|texto> [--out respuesta.mp3]');

  let res;
  if (args.length === 1 && fs.existsSync(args[0])) {
    const boundary = `----n8nteam${Date.now()}`;
    res = await postToN8n(ENDPOINTS.voice, multipartBody(boundary, args[0], fs.readFileSync(args[0])), {
      raw: true,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    });
  } else {
    res = await postToN8n(ENDPOINTS.voice, { text: input }, { raw: true });
  }
  const decode = (name) => { try { return decodeURIComponent(res.headers[name] || ''); } catch { return ''; } };
  if (decode('x-transcripcion')) console.log(`${DIM}Tu:${RESET} ${decode('x-transcripcion')}`);
  if (decode('x-respuesta')) console.log(`${DIM}Agente:${RESET} ${decode('x-respuesta')}`);
  console.log(`Audio guardado en ${saveAudio(res, out)}`);
}

async function embedOverrides() {
  const { resolved } = await resolveModels();
  return { embedModel: resolved.embedding.selected };
}

async function runMemoryIngest(args) {
  const target = args[0];
  if (!target) throw new Error('Uso: --memory-ingest <archivo|carpeta>');
  const overrides = await embedOverrides();
  const summary = await memory.ingestPath(target, overrides, (source, chunks) => {
    console.log(`  ${GREEN}+${RESET} ${source} (${chunks} fragmentos)`);
  });
  console.log(`Memoria actualizada: ${summary.files} archivos, ${summary.chunks} fragmentos (${summary.skipped} omitidos).`);
}

async function runMemorySearch(args) {
  const query = args.join(' ').trim();
  if (!query) throw new Error('Uso: --memory-search "consulta"');
  const { results } = await memory.search({ query }, await embedOverrides());
  if (!results.length) {
    console.log('Sin resultados.');
    return;
  }
  for (const hit of results) {
    console.log(`${BOLD}${hit.score}${RESET} ${CYAN}${hit.source}${RESET}`);
    console.log(`  ${String(hit.text).slice(0, 300).replace(/\s+/g, ' ')}`);
  }
}

function printHelp() {
  console.log(`Uso:
  n8n-team                         Chat interactivo
  n8n-team --list                  Lista agentes
  n8n-team --status                Estado n8n/Ollama
  n8n-team --doctor                Diagnostico local
  n8n-team --test                  Prueba webhooks
  n8n-team --agent 2 "mensaje"     Envia mensaje directo
  n8n-team --agent 5 "mensaje"     Terminal Coder (edita archivos reales)

Modelos:
  n8n-team --models                Modelo elegido por rol (con fallbacks)
  n8n-team --pull-models [--all]   Descarga los modelos preferidos que falten

Multimodal (requiere workflows activos):
  n8n-team --ocr foto.png [--mode texto|documento|salud] [--json]
  n8n-team --tts "Hola" [--out voz.mp3]
  n8n-team --voice pregunta.wav [--out respuesta.mp3]

Memoria (requiere Qdrant + modelo de embeddings):
  n8n-team --memory-ingest ./docs  Indexa archivos de texto/codigo
  n8n-team --memory-search "..."   Busca en la memoria del equipo

Comandos chat:
  /switch N, /agents, /models, /status, /doctor, /help, /exit`);
}

async function interactiveChat() {
  printBanner();
  if (!(await checkN8nHealth())) {
    console.log(`${RED}n8n no esta corriendo. Ejecuta npm start.${RESET}`);
    process.exit(1);
  }
  if (!(await getOllamaModels()).length) {
    console.log(`${RED}Ollama no esta corriendo o no responde.${RESET}`);
    process.exit(1);
  }

  await printAgentList();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let currentAgent = AGENTS[0];
  let sessionId = `cli-${Date.now()}`;

  const ask = () => {
    rl.question(`${currentAgent.color}[${currentAgent.name}]${RESET} Tu: `, async (input) => {
      const text = input.trim();
      if (!text) return ask();
      if (text === '/exit' || text === '/quit') {
        rl.close();
        return;
      }
      if (text === '/help') { printHelp(); return ask(); }
      if (text === '/agents') { await printAgentList(); return ask(); }
      if (text === '/models') { await printModels(); return ask(); }
      if (text === '/status') { await printStatus(); return ask(); }
      if (text === '/doctor') { await doctor(); return ask(); }
      if (text.startsWith('/switch')) {
        const next = AGENTS.find((agent) => agent.id === Number(text.split(/\s+/)[1]));
        if (!next) console.log(`${RED}Agente invalido.${RESET}`);
        else {
          currentAgent = next;
          sessionId = `cli-${Date.now()}`;
          console.log(`Cambiado a ${currentAgent.name}.`);
        }
        return ask();
      }

      try {
        console.log(`${DIM}Procesando...${RESET}`);
        console.log(await sendToAgent(currentAgent, text, sessionId));
      } catch (err) {
        console.log(`${RED}${err.message}${RESET}`);
      }
      ask();
    });
  };
  ask();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return printHelp();

  // Multimodal and memory commands take everything after their flag as input.
  if (args.includes('--ocr')) return runOcr(afterFlag(args, '--ocr'));
  if (args.includes('--tts')) return runTts(afterFlag(args, '--tts'));
  if (args.includes('--voice')) return runVoice(afterFlag(args, '--voice'));
  if (args.includes('--memory-ingest')) return runMemoryIngest(afterFlag(args, '--memory-ingest'));
  if (args.includes('--memory-search')) return runMemorySearch(afterFlag(args, '--memory-search'));

  if (args.includes('--list')) return printAgentList();
  if (args.includes('--status')) return printStatus();
  if (args.includes('--models')) return printModels();
  if (args.includes('--pull-models')) return pullModels(args.includes('--all'));
  if (args.includes('--doctor') || args.includes('doctor')) return doctor();
  if (args.includes('--test')) return testAllAgents();

  const agentIdx = args.indexOf('--agent');
  if (agentIdx !== -1) {
    const agent = AGENTS.find((item) => item.id === Number(args[agentIdx + 1]));
    const message = args.slice(agentIdx + 2).join(' ');
    if (!agent) throw new Error('Agente invalido. Usa --list.');
    if (!message) throw new Error('Falta mensaje.');
    console.log(await sendToAgent(agent, message, `cli-oneshot-${Date.now()}`));
    return;
  }

  await interactiveChat();
}

main().catch((err) => {
  console.error(`${RED}Error:${RESET} ${err.message}`);
  process.exit(1);
});
