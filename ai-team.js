#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');
const readline = require('readline');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...parts] = trimmed.split('=');
    if (!process.env[key]) process.env[key] = parts.join('=').trim();
  }
}

loadEnvFile(path.join(__dirname, '.env'));
loadEnvFile(path.join(process.cwd(), '.env'));

const N8N_BASE = process.env.N8N_BASE_URL || 'http://localhost:5678';
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const REQUIRED_MODELS = [
  'mistral-small:latest',
  'qwen3-coder:30b',
  'deepseek-r1:14b',
  'deepseek-coder-v2:16b',
];

const AGENTS = [
  {
    id: 0,
    name: 'Supervisor',
    model: 'mistral-small:latest',
    webhook: '/webhook/agente-supervisor/chat',
    description: 'Orquesta el equipo y enruta tareas.',
    color: '\x1b[31m',
  },
  {
    id: 1,
    name: 'Analista',
    model: 'deepseek-r1:14b',
    webhook: '/webhook/agente-analista/chat',
    description: 'Descubre requisitos, riesgos y arquitectura.',
    color: '\x1b[35m',
  },
  {
    id: 2,
    name: 'Programador',
    model: 'qwen3-coder:30b',
    webhook: '/webhook/agente-programador/chat',
    description: 'Implementa cambios concretos.',
    color: '\x1b[32m',
  },
  {
    id: 3,
    name: 'Revisor QA',
    model: 'deepseek-coder-v2:16b',
    webhook: '/webhook/agente-revisor/chat',
    description: 'Revisa bugs, seguridad y pruebas.',
    color: '\x1b[33m',
  },
  {
    id: 4,
    name: 'DevOps Runtime',
    model: 'mistral-small:latest',
    webhook: '/webhook/agente-devops/chat',
    description: 'Valida runtime, logs, health checks y despliegue local.',
    color: '\x1b[36m',
  },
];

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

function requestJson(method, rawUrl, body, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const url = new URL(rawUrl);
    const payload = body ? JSON.stringify(body) : undefined;
    const client = url.protocol === 'https:' ? require('https') : http;
    const req = client.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        : {},
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function sendToAgent(agent, message, sessionId) {
  const res = await requestJson('POST', new URL(agent.webhook, N8N_BASE), {
    action: 'sendMessage',
    chatInput: message,
    sessionId,
  }, Number(process.env.N8N_TEAM_TIMEOUT_MS || 300000));

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

async function getOllamaModels() {
  try {
    const res = await requestJson('GET', new URL('/api/tags', OLLAMA_BASE), null, 3000);
    const parsed = JSON.parse(res.data);
    return Array.isArray(parsed.models) ? parsed.models.map((m) => m.name) : [];
  } catch {
    return [];
  }
}

function printBanner() {
  console.log(`${BOLD}${CYAN}n8n AI Team CLI${RESET}`);
}

function printAgentList() {
  console.log(`${BOLD}Agentes:${RESET}`);
  for (const agent of AGENTS) {
    console.log(`  ${agent.color}[${agent.id}] ${agent.name}${RESET} ${DIM}${agent.model}${RESET}`);
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

async function doctor() {
  let failures = 0;
  const n8nOk = await checkN8nHealth();
  const models = await getOllamaModels();
  const workflowDir = path.join(__dirname, 'workflows');
  const workflowFiles = fs.existsSync(workflowDir)
    ? fs.readdirSync(workflowDir).filter((f) => f.endsWith('.json')).sort()
    : [];

  console.log(`${BOLD}Doctor n8n AI Team${RESET}`);
  console.log(`  Node: ${process.version}`);
  console.log(`  n8n: ${n8nOk ? `${GREEN}ok` : `${RED}offline`}${RESET}`);
  if (!n8nOk) failures += 1;
  console.log(`  Ollama: ${models.length ? `${GREEN}ok` : `${RED}offline`}${RESET}`);
  if (!models.length) failures += 1;

  for (const model of REQUIRED_MODELS) {
    const ok = models.includes(model);
    console.log(`  Modelo ${model}: ${ok ? `${GREEN}ok` : `${YELLOW}faltante`}${RESET}`);
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

  if (!process.env.N8N_API_KEY) {
    console.log(`  N8N_API_KEY: ${YELLOW}no configurada${RESET} (solo necesaria para importar/activar)`);
  } else {
    console.log(`  N8N_API_KEY: ${GREEN}configurada${RESET}`);
  }

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

function printHelp() {
  console.log(`Uso:
  n8n-team                         Chat interactivo
  n8n-team --list                  Lista agentes
  n8n-team --status                Estado n8n/Ollama
  n8n-team --doctor                Diagnostico local
  n8n-team --test                  Prueba webhooks
  n8n-team --agent 2 "mensaje"     Envia mensaje directo

Comandos chat:
  /switch N, /agents, /status, /doctor, /help, /exit`);
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

  printAgentList();
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
      if (text === '/agents') { printAgentList(); return ask(); }
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
  if (args.includes('--list')) return printAgentList();
  if (args.includes('--status')) return printStatus();
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
