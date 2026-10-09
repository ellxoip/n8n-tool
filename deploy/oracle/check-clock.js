const assert = require('node:assert/strict');
const fs = require('fs');
async function ask(text, audio) {
  let options;
  if (audio) {
    const speech = await fetch('http://127.0.0.1:8000/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: text, response_format: 'wav' }) });
    assert.ok(speech.ok);
    const form = new FormData(); form.append('file', await speech.blob(), 'question.wav'); form.append('web', 'off'); form.append('sessionId', 'oracle-clock-' + Date.now());
    options = { method: 'POST', body: form };
  } else options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, web: 'off', sessionId: 'oracle-clock-' + Date.now() }) };
  const start = performance.now();
  const result = await fetch('http://127.0.0.1:5678/webhook/voz-agente', { ...options, signal: AbortSignal.timeout(300000) });
  assert.ok(result.ok);
  const bytes = (await result.arrayBuffer()).byteLength;
  const reply = decodeURIComponent(result.headers.get('x-respuesta') || '');
  const transcript = decodeURIComponent(result.headers.get('x-transcripcion') || '');
  const item = { text, audio, seconds: Number(((performance.now() - start) / 1000).toFixed(2)), bytes, transcript, reply, clockVerified: /\b\d{1,2}:\d{2}:\d{2}\b/.test(reply) && reply.includes('Chile') };
  console.log(JSON.stringify(item));
  return item;
}
(async () => {
  const results = [];
  results.push(await ask('Dime qué hora es en Chile', false));
  results.push(await ask('Dime qué hora es en Chile', true));
  if (process.env.ORACLE_CLOCK_ONLY !== 'true') results.push(await ask('Explica brevemente qué es una red neuronal', true));
  fs.writeFileSync('/app/.runtime/oracle-clock-results.json', JSON.stringify(results, null, 2));
  assert.ok(results[0].clockVerified, 'Written clock failed');
  assert.ok(results[1].clockVerified, 'Audio clock failed');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
