// Run inside the isolated Oracle pod. Do not print credentials or conversation history.
require('../../scripts/lib/common').loadEnv();
const fs = require('fs');
const assert = require('node:assert/strict');
const checks = [];
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(300000) });
  assert.ok(response.ok, `${url}: HTTP ${response.status}`);
  return response;
}
const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function main() {
  for (const [label, url] of [['n8n', 'http://127.0.0.1:5677/healthz'], ['bridge', 'http://127.0.0.1:8787/health'], ['voice', 'http://127.0.0.1:8000/health'], ['qdrant', 'http://127.0.0.1:6333/healthz'], ['gateway', 'http://127.0.0.1:5678/healthz']]) {
    await request(url); checks.push({ label, ok: true });
  }
  const workflows = await (await request('http://127.0.0.1:5677/api/v1/workflows?limit=250', { headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY } })).json();
  assert.equal(workflows.data.length, 11);
  assert.equal(workflows.data.filter(w => w.active).length, 11);
  checks.push({ label: 'workflows', count: 11, active: 11 });
  const info = await (await request('http://127.0.0.1:6333/collections/' + process.env.QDRANT_COLLECTION)).json();
  assert.equal(info.result.points_count, 23);
  checks.push({ label: 'memory-copy', points: info.result.points_count });
  const memory = await (await request('http://127.0.0.1:8787/memory/search', { ...json({ query: 'proyecto agentes', limit: 2 }), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.BRIDGE_TOKEN } })).json();
  assert.ok(memory.results.length);
  checks.push({ label: 'memory-search', results: memory.results.length });
  const page = await (await request('http://127.0.0.1:5678/webhook/voz')).text();
  assert.ok(page.includes('conversation.mjs'));
  checks.push({ label: 'voice-page', ok: true });
  for (const [question, audio, web] of [['Qué hora es en Chile', true, 'off'], ['Explica brevemente qué es una red neuronal', true, 'off'], ['Quién fue Ada Lovelace', false, 'auto'], ['Cómo estará el clima mañana en Valdivia Chile', false, 'auto']]) {
    let options;
    if (audio) {
      const speech = await request('http://127.0.0.1:8000/v1/audio/speech', json({ input: question, response_format: 'wav' }));
      const form = new FormData();
      form.append('file', await speech.blob(), 'question.wav');
      form.append('web', web); form.append('sessionId', 'oracle-benchmark-' + Date.now());
      options = { method: 'POST', body: form };
    } else options = json({ text: question, web, sessionId: 'oracle-benchmark-' + Date.now() });
    const start = performance.now();
    const result = await request('http://127.0.0.1:5678/webhook/voz-agente', options);
    const bytes = (await result.arrayBuffer()).byteLength;
    assert.ok(bytes > 44);
    const item = { label: 'voice-benchmark', question, audio, seconds: Number(((performance.now() - start) / 1000).toFixed(2)), bytes, transcript: decodeURIComponent(result.headers.get('x-transcripcion') || ''), reply: decodeURIComponent(result.headers.get('x-respuesta') || '') };
    checks.push(item); console.log(JSON.stringify(item));
  }
  fs.writeFileSync('/app/.runtime/oracle-results.json', JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
  console.log(JSON.stringify({ ok: true, checks: checks.length }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
