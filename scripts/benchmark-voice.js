// Real STT -> conversational model -> Piper. Audio stays in memory.
const https = require('https');
const fs = require('fs');
const assert = require('node:assert/strict');
const ca = fs.readFileSync('.runtime/tls/local-ca.crt');
async function ask(text, audio, web = 'off') {
  let body, contentType;
  if (audio) {
    const speech = await fetch('http://127.0.0.1:8000/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: text, response_format: 'wav' }) });
    if (!speech.ok) throw new Error('Test speech failed');
    const form = new FormData();
    form.append('file', await speech.blob(), 'question.wav'); form.append('web', web); form.append('sessionId', 'benchmark-' + Date.now());
    const request = new Request('http://local', { method: 'POST', body: form });
    contentType = request.headers.get('content-type'); body = Buffer.from(await request.arrayBuffer());
  } else { contentType = 'application/json'; body = Buffer.from(JSON.stringify({ text, web, sessionId: 'benchmark-' + Date.now() })); }
  return new Promise((resolve,reject) => {
    const begin = performance.now();
    const req = https.request({ hostname: '192.168.100.62', port: 5678, path: '/webhook/voz-agente', method: 'POST', ca, headers: { 'Content-Type': contentType, 'Content-Length': body.length } }, res => {
      let bytes = 0; res.on('data', chunk => bytes += chunk.length);
      res.on('end', () => {
        assert.equal(res.statusCode, 200); assert.ok(bytes > 44);
        resolve({ question: text, audio, seconds: Number(((performance.now()-begin)/1000).toFixed(2)), transcript: decodeURIComponent(res.headers['x-transcripcion'] || ''), reply: decodeURIComponent(res.headers['x-respuesta'] || '') });
      });
    });
    req.on('error', reject); req.setTimeout(90000, () => req.destroy(new Error('Benchmark timeout'))); req.end(body);
  });
}
(async () => {
  for (const [text,audio,web] of [['Qué hora es en Chile',true,'off'],['Explica brevemente qué es una red neuronal',true,'off'],['Quién fue Ada Lovelace',false,'auto']]) console.log(JSON.stringify(await ask(text,audio,web)));
})().catch(error => { console.error(error.message); process.exitCode=1; });
