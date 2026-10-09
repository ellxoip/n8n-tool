#!/usr/bin/env node
// Local bridge between n8n and things n8n should not do itself:
//  - POST /terminal/run   run Aider/OpenCode inside a sandboxed workspace folder
//  - POST /memory/ingest  chunk + embed + store text in Qdrant
//  - POST /memory/search  semantic search over the team memory
// Binds to loopback and requires a bearer token (BRIDGE_TOKEN).

const crypto = require('crypto');
const http = require('http');
const path = require('path');

const { loadEnv, ollamaBaseUrl, root } = require('../../scripts/lib/common');
const { selectedModel } = require('../../scripts/lib/models');
const memory = require('../../scripts/lib/memory');
const terminal = require('./terminal');
const projects = require('./projects');
const { createJobStore } = require('./jobs');
const { answerVoice, searchWeb, warmVoiceModel, createFactResponder } = require('./voice-context');

loadEnv();

const MAX_BODY_BYTES = 1024 * 1024;

function tokensMatch(expected, provided) {
  const a = crypto.createHash('sha256').update(String(expected)).digest();
  const b = crypto.createHash('sha256').update(String(provided || '')).digest();
  return crypto.timingSafeEqual(a, b);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Body demasiado grande (max 1MB).'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON invalido.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function createServer({ token, jobStore }) {
  let jobs = jobStore;
  const getJobs = () => jobs ||= createJobStore({ directory: path.join(root, '.runtime', 'jobs'), execute: async (body, onProgress) => terminal.runTerminalTask(body, { model: await selectedModel('programmer'), ollamaBase: ollamaBaseUrl(), onProgress }) });
  const routes = {
    'POST /facts/current': createFactResponder(),
    'POST /voice/answer': answerVoice,
    'POST /web/search': body => searchWeb(body.query),
    'GET /health': async () => ({ ok: true, service: 'n8n-tool-bridge', workspace: terminal.workspaceRoot() }),

    'POST /projects/inspect': async (body) => projects.inspectProject(body.path),

    'POST /terminal/run': async (body) => {
      const model = body.model || await selectedModel('programmer');
      return terminal.runTerminalTask(body, { model, ollamaBase: ollamaBaseUrl() });
    },

    'POST /memory/ingest': async (body) => {
      if (!String(body.text || '').trim()) throw Object.assign(new Error('Falta "text".'), { status: 400 });
      return memory.ingestText({ text: body.text, source: body.source || 'n8n', metadata: body.metadata || {} }, { collection: body.collection, embedModel: await selectedModel('embedding') });
    },

    'POST /memory/search': async (body) => {
      if (!String(body.query || '').trim()) throw Object.assign(new Error('Falta "query".'), { status: 400 });
      return memory.search({ query: body.query, limit: body.limit }, { collection: body.collection, embedModel: await selectedModel('embedding') });
    },
  };

  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://bridge.local').pathname;
    let route = routes[`${req.method} ${pathname}`];
    if (pathname === '/jobs' && req.method === 'GET') route = async () => ({ jobs: getJobs().list() });
    if (pathname === '/jobs' && req.method === 'POST') route = async body => getJobs().create(body);
    const jobMatch = pathname.match(/^\/jobs\/([a-f0-9-]+)(?:\/(approve|reject|accept|changes))?$/);
    if (jobMatch && req.method === 'GET' && !jobMatch[2]) route = async () => getJobs().get(jobMatch[1]);
    if (jobMatch && req.method === 'POST' && jobMatch[2]) route = async () => getJobs().action(jobMatch[1], jobMatch[2]);
    if (!route) return send(res, 404, { ok: false, error: 'Ruta no encontrada.' });

    if (pathname !== '/health') {
      const header = req.headers.authorization || '';
      const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!tokensMatch(token, provided)) return send(res, 401, { ok: false, error: 'Token invalido.' });
    }

    try {
      const body = req.method === 'POST' ? await readJson(req) : {};
      send(res, 200, await route(body));
    } catch (err) {
      send(res, err.status || 500, { ok: false, error: err.message });
    }
  });
}

function main() {
  const token = process.env.BRIDGE_TOKEN;
  if (!token || token.length < 16) {
    console.error('Bridge: define BRIDGE_TOKEN (min 16 caracteres) en .env. `n8n-tool` lo genera automaticamente.');
    process.exit(1);
  }
  const host = process.env.BRIDGE_HOST || '127.0.0.1';
  const port = Number(process.env.BRIDGE_PORT || 8787);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && process.env.BRIDGE_ALLOW_REMOTE !== 'true') {
    console.error(`Bridge: BRIDGE_HOST=${host} expone ejecucion de comandos en la red. Usa 127.0.0.1 o BRIDGE_ALLOW_REMOTE=true bajo tu responsabilidad.`);
    process.exit(1);
  }
  createServer({ token }).listen(port, host, () => {
    console.log(`Bridge escuchando en http://${host}:${port} (workspace: ${path.relative(process.cwd(), terminal.workspaceRoot()) || '.'})`);
    warmVoiceModel().then(() => console.log('Modelo de voz preparado en memoria.')).catch(error => console.warn('No se pudo precargar el modelo de voz: ' + error.message));
  });
}

if (require.main === module) main();

module.exports = { createServer, tokensMatch };
