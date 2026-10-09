const https = require('https');
const fs = require('fs');
const assert = require('node:assert/strict');
require('./lib/common').loadEnv();
const ca = fs.readFileSync('.runtime/tls/local-ca.crt');
const sessionId = 'voice-live-' + Date.now();
function speak(text, web = 'auto', selectedSession = sessionId, settings = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = https.request({ host: '192.168.100.62', port: 5678, path: '/webhook/voz-agente', method: 'POST', ca, headers: { 'Content-Type': 'application/json' } }, res => {
      let bytes = 0; res.on('data', chunk => bytes += chunk.length);
      res.on('end', () => {
        if (res.statusCode !== 200 || !String(res.headers['content-type']).includes('audio/')) return reject(new Error('HTTP ' + res.statusCode));
        const read = name => decodeURIComponent(res.headers[name] || '');
        resolve({ reply: read('x-respuesta'), sources: JSON.parse(read('x-fuentes') || '[]'), memory: JSON.parse(read('x-memoria') || '{}'), status: read('x-web-estado'), seconds: (Date.now() - start) / 1000, bytes });
      });
    });
    req.on('error', reject); req.setTimeout(150000, () => req.destroy(new Error('Voice test timeout')));
    req.end(JSON.stringify({ text, sessionId: selectedSession, web, ...settings }));
  });
}
async function main() {
  if (process.argv.includes('--locality')) {
    const id = 'voice-locality-' + Date.now();
    for (const [question, expected] of [
      ['¿Qué horas son ahora?', /Chile|Santiago/],
      ['Vivo en Valdivia, Chile', /Recordaré.*Valdivia/],
      ['¿Cómo estará el clima en mi localidad?', /Valdivia.*grados Celsius/],
      ['¿Y mañana?', /Valdivia.*mañana/],
      ['¿Cómo estará el clima en la localidad de Los Andes, Chile?', /Los Andes.*grados Celsius/],
      ['¿Qué hora es aquí?', /Valdivia/],
    ]) {
      const result = await speak(question, 'auto', id);
      console.log(question + ': ' + result.reply + ' (' + result.seconds + 's)');
      assert.match(result.reply, expected);
    }
    let result = await speak('¿Cómo estará el clima mañana en mi localidad?', 'auto', id + '-missing');
    assert.match(result.reply, /localidad y país/);
    result = await speak('Los Andes, Chile', 'auto', id + '-missing');
    console.log('Localidad tras aclaración: ' + result.reply);
    assert.match(result.reply, /Los Andes.*mañana/);
    result = await speak('¿Cómo estará el clima en mi localidad?', 'auto', id + '-settings', { city: 'Valdivia, Chile' });
    assert.match(result.reply, /Valdivia.*grados Celsius/);
    console.log('LIVE_LOCALITY_CLOCK_WEATHER_OK'); return;
  }
  if (process.argv.includes('--memory')) {
    const id = 'voice-memory-' + Date.now();
    let result = await speak('Me llamo Carlos y prefiero respuestas en español.', 'off', id);
    assert.ok(result.memory.turns >= 1);
    result = await speak('¿Quién fue Ada Lovelace?', 'auto', id);
    console.log('Tema: ' + result.reply);
    result = await speak('¿Y en qué año nació?', 'auto', id);
    console.log('Referencia: ' + result.reply);
    assert.match(result.reply, /1815/); assert.match(result.memory.topic, /Ada Lovelace/);
    result = await speak('¿Recuerdas cómo me llamo y en qué idioma prefiero hablar?', 'off', id);
    assert.match(result.reply, /Carlos/); assert.match(result.reply, /español/i);
    console.log('Preferencias: ' + result.reply);
    console.log('LIVE_CONTEXT_MEMORY_OK: topic, pronoun resolution, personal preferences'); return;
  }
  for (const text of ['Qué hora es en Chile', 'Qué hora es en Tokio', 'Cómo estará el tiempo hoy en Santiago, Chile', '¿Y mañana?', 'Quién es el presidente actual de Chile']) {
    const value = await speak(text);
    assert.ok(value.bytes > 44); assert.ok(value.reply);
    if (/tiempo|mañana/.test(text)) assert.ok(value.sources.some(x => x.title.includes('Open-Meteo')));
    if (/presidente/.test(text)) assert.ok(value.sources.length > 0);
    console.log(text + ': ' + value.reply + ' (' + value.seconds + 's; sources=' + value.sources.length + ')');
  }
  console.log('LIVE_VOICE_CONTEXT_OK');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
