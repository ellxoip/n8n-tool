const fs = require('fs');
const assert = require('node:assert/strict');
(async () => {
  const rows = [];
  for (const input of ['Dime qué hora es en Chile', 'Qué hora es en Chile', 'Explica brevemente qué es una red neuronal']) {
    const speech = await fetch('http://127.0.0.1:8000/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, response_format: 'wav' }) });
    assert.ok(speech.ok);
    const form = new FormData(); form.append('file', await speech.blob(), 'question.wav');
    const start = performance.now();
    const response = await fetch('http://127.0.0.1:8000/v1/audio/transcriptions', { method: 'POST', body: form, signal: AbortSignal.timeout(90000) });
    assert.ok(response.ok);
    const result = await response.json();
    const row = { input, transcript: result.text, seconds: Number(((performance.now() - start) / 1000).toFixed(2)) };
    rows.push(row); console.log(JSON.stringify(row));
  }
  fs.writeFileSync('/app/.runtime/oracle-stt-results.json', JSON.stringify(rows, null, 2));
  assert.ok(rows[0].transcript.toLowerCase().includes('hora'), 'Clock recognition failed');
  assert.ok(rows[1].transcript.toLowerCase().includes('hora'), 'Short clock recognition failed');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
