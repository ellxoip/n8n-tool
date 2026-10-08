const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [rawKey, ...parts] = trimmed.split('=');
    const key = rawKey.trim();
    if (process.env[key]) continue;
    process.env[key] = parts.join('=').trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

function loadEnv() {
  loadEnvFile(path.join(root, '.env'));
  loadEnvFile(path.join(process.cwd(), '.env'));
}

// Low-level request that keeps the body as a Buffer (audio, images) and accepts a Buffer payload.
function requestRaw(method, rawUrl, payload, timeoutMs = 5000, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(rawUrl);
    const client = url.protocol === 'https:' ? https : http;
    const reqHeaders = { ...headers };
    if (payload) reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    const req = client.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method,
      headers: reqHeaders,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function requestJson(method, rawUrl, body, timeoutMs = 5000, headers = {}) {
  const payload = body ? JSON.stringify(body) : undefined;
  const res = await requestRaw(
    method,
    rawUrl,
    payload,
    timeoutMs,
    payload ? { 'Content-Type': 'application/json', ...headers } : headers,
  );
  return { status: res.status, data: res.buffer.toString('utf8') };
}

// True when something answers HTTP at the URL (any status below 500).
async function isServiceUp(rawUrl, timeoutMs = 2000) {
  try {
    const res = await requestJson('GET', rawUrl, null, timeoutMs);
    return res.status < 500;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ollamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
}

async function getOllamaModels(timeoutMs = 3000) {
  try {
    const res = await requestJson('GET', `${ollamaBaseUrl()}/api/tags`, null, timeoutMs);
    const parsed = JSON.parse(res.data);
    return Array.isArray(parsed.models) ? parsed.models.map((m) => m.name) : [];
  } catch {
    return [];
  }
}

module.exports = {
  root,
  loadEnvFile,
  loadEnv,
  requestRaw,
  requestJson,
  isServiceUp,
  sleep,
  ollamaBaseUrl,
  getOllamaModels,
};
