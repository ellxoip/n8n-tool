const test = require('node:test');
const assert = require('node:assert/strict');
const { clock, intentFor, knownPlace, searchWeb, weatherSummary, remember, memoryText, isFollowUp, locationText, answerVoice } = require('../services/bridge/voice-context');
const core = import('../services/voice/vad-core.mjs');
const frame = (rms = 0, bandRatio = 0.8) => ({ pcm: new Float32Array(320).fill(rms), rms, bandRatio });
test('VAD ignores silence and brief clicks, detects speech, sends after silence and releases buffers', async () => {
  const { VoiceDetector } = await core, vad = new VoiceDetector();
  for (let i = 0; i < 200; i++) vad.push(frame(0.001));
  assert.equal(vad.active, false); assert.ok(vad.preRoll.length <= 13);
  for (let i = 0; i < 4; i++) vad.push(frame(0.1));
  let result;
  for (let i = 0; i < 60; i++) { const value = vad.push(frame()); if (value.state === 'discarded') result = value; }
  assert.equal(result.state, 'discarded'); assert.equal(vad.frames.length, 0);
  for (let i = 0; i < 80; i++) vad.push(frame(0.035));
  assert.equal(vad.active, true);
  for (let i = 0; i < 55; i++) result = vad.push(frame());
  assert.equal(result.state, 'complete'); assert.ok(result.trimSamples > 0);
  assert.equal(vad.frames.length, 0); assert.equal(vad.preRoll.length, 0);
});
test('VAD bounds sustained speech to 45 seconds and rejects low-frequency noise', async () => {
  const { VoiceDetector } = await core, vad = new VoiceDetector();
  for (let i = 0; i < 30; i++) vad.push(frame());
  for (let i = 0; i < 500; i++) vad.push(frame(0.05, 0.05));
  assert.equal(vad.active, false);
  let result;
  for (let i = 0; i < 2250; i++) { const value = vad.push(frame(0.04)); if (value.state === 'complete') { result = value; break; } }
  assert.equal(result.state, 'complete'); assert.ok(result.frames.length <= 2250);
  vad.reset(); assert.equal(vad.frames.length, 0);
});
test('WAV is mono PCM 16 kHz, clips correctly and trims trailing silence', async () => {
  const { encodeWav } = await core;
  const view = new DataView(encodeWav([new Float32Array([2, -2, 0, 0])], 2));
  assert.equal(view.byteLength, 48); assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getInt16(44, true), 32767); assert.equal(view.getInt16(46, true), -32768);
});
test('clock uses actual IANA dates and daylight saving, not a model guess', () => {
  assert.match(clock('America/Santiago', new Date('2026-01-01T01:00:00Z')).local, /22:00:00/);
  assert.match(clock('Asia/Tokyo', new Date('2026-01-01T01:00:00Z')).local, /10:00:00/);
  assert.throws(() => clock('invented/zone'));
  assert.equal(knownPlace('Hora en Punta Arenas, Chile')[1], 'America/Punta_Arenas');
});
test('follow-up weather and clock questions retain context', () => {
  assert.equal(intentFor('¿Cómo estará el clima hoy?'), 'weather');
  assert.equal(intentFor('¿Y mañana?', 'weather'), 'weather');
  assert.equal(intentFor('Qué hora es en Chile'), 'clock');
  assert.equal(intentFor('gracias', 'weather'), 'general');
  assert.equal(intentFor('¿Qué horas son ahora?'), 'clock');
  assert.equal(locationText('Vivo en Valdivia, Chile'), 'Valdivia, Chile');
  assert.equal(locationText('Clima en la localidad de Los Andes Chile mañana'), 'Los Andes, Chile');
  assert.equal(locationText('Clima en mi localidad'), '');
});
test('local climate uses home rather than a previously queried foreign city; clarification preserves tomorrow', async () => {
  const original = global.fetch;
  const today = clock('America/Santiago').date;
  const tomorrow = new Date(Date.parse(today + 'T12:00:00Z') + 86400000).toISOString().slice(0,10);
  global.fetch = async url => {
    const target = String(url);
    if (target.includes('geocoding-api')) {
      assert.match(target, /Valdivia/);
      return Response.json({ results: [{ name: 'Valdivia', country: 'Chile', country_code: 'CL', latitude: -39.8, longitude: -73.2, timezone: 'America/Santiago' }] });
    }
    if (target.includes('api.open-meteo')) return Response.json({ daily: { time: [today, tomorrow], weather_code: [0,61], temperature_2m_min: [8,7], temperature_2m_max: [18,16], precipitation_probability_max: [5,80] } });
    throw new Error('Unexpected model/network request: ' + target);
  };
  try {
    const local = await answerVoice({ transcript: 'Cómo estará el clima en mi localidad', context: { home: { name: 'Valdivia, Chile' }, place: { name: 'Tokio', timezone: 'Asia/Tokyo' } } });
    assert.match(local.message.content, /Valdivia/); assert.doesNotMatch(local.message.content, /Tokio/);
    const asked = await answerVoice({ transcript: 'Cómo estará el clima mañana en mi localidad' });
    assert.equal(asked.context.pendingIntent, 'weather');
    const response = await answerVoice({ transcript: 'Valdivia, Chile', context: asked.context });
    assert.match(response.message.content, /mañana/); assert.match(response.message.content, /lluvia ligera/);
    const hour = await answerVoice({ transcript: '¿Qué horas son ahora?' });
    assert.match(hour.message.content, /Santiago.*\d{2}:\d{2}:\d{2}/);
  } finally { global.fetch = original; }
});
test('search failures are explicit and unsafe URLs are not passed to the model', async () => {
  const original = global.fetch;
  global.fetch = async url => new Response(String(url).includes('bing.com') ? '<rss><channel><item><title>Unsafe</title><link>javascript:bad()</link></item></channel></rss>' : '{}');
  try { const result = await searchWeb('test'); assert.equal(result.status, 'unavailable'); assert.deepEqual(result.results, []); }
  finally { global.fetch = original; }
});
test('weather uses dated values and WMO labels without guessing, retaining the selected day', () => {
  const now = clock('America/Santiago').date;
  const tomorrow = new Date(Date.parse(now + 'T12:00:00Z') + 86400000).toISOString().slice(0,10);
  const previous = {};
  const values = { daily: { time: [now, tomorrow], weather_code: [80, 51], temperature_2m_min: [8, 10], temperature_2m_max: [15, 18], precipitation_probability_max: [40, 70], precipitation_sum: [1, 2] } };
  const place = { name: 'Santiago', timezone: 'America/Santiago' };
  assert.match(weatherSummary('hoy', place, values, previous), /chubascos ligeros/);
  assert.match(weatherSummary('mañana', place, values, previous), /llovizna ligera/);
  assert.equal(previous.weatherDay, tomorrow);
  assert.match(weatherSummary('necesito paraguas', place, values, previous), /Conviene llevar paraguas/);
  assert.match(weatherSummary('el 1900-01-01', place, values, previous), /No tengo datos/);
});
test('context memory retains explicit preferences, older relevant turns and bounded recent topics', () => {
  const context = {};
  remember(context, 'Me llamo Carlos y prefiero español', 'Entendido.');
  remember(context, 'Hablemos de Ada Lovelace', 'Ada Lovelace fue matemática.');
  remember(context, '¿Y cuándo nació?', 'Nació en 1815.');
  assert.equal(context.topic, 'Hablemos de Ada Lovelace');
  assert.ok(isFollowUp('¿Qué edad tenía?', true));
  assert.match(memoryText(context, 'Ada'), /Lovelace/);
  for (let i = 0; i < 40; i++) remember(context, 'Tema ' + i, 'Respuesta '.repeat(100));
  assert.equal(context.notes.length, 18);
  assert.match(memoryText(context, 'otro tema'), /Carlos/);
  assert.ok(memoryText(context, 'otro tema').length <= 5500);
});
