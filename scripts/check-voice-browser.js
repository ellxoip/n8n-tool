// Real browser/audio-thread check; the model response is mocked to isolate VAD.
const { chromium } = require('playwright');
const fs = require('fs');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'carlos-voice-check-'));
  let browser;
  try {
    const speech = await fetch('http://127.0.0.1:8000/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'Hola, esta es una prueba de conversación por voz.', response_format: 'wav' }) });
    if (!speech.ok) throw new Error('Piper test fixture unavailable');
    const speechFile = path.join(directory, 'speech.wav'), captureFile = path.join(directory, 'capture.wav');
    fs.writeFileSync(speechFile, Buffer.from(await speech.arrayBuffer()));
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', speechFile, '-af', 'adelay=1200,apad=pad_dur=2', '-ar', '48000', '-ac', '1', captureFile]);
    browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + captureFile, '--autoplay-policy=no-user-gesture-required'] });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') console.log('Browser console: ' + message.text()); });
    page.on('requestfailed', request => console.log('Failed request: ' + request.url() + ' ' + request.failure()?.errorText));
    await page.addInitScript(() => {
      const resources = window.__voiceResources = { urls: new Set(), streams: [], contexts: [] };
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); resources.urls.add(url); return url; };
      URL.revokeObjectURL = url => { resources.urls.delete(url); revoke(url); };
      const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async opts => { const stream = await get(opts); resources.streams.push(stream); return stream; };
      const Original = window.AudioContext;
      window.AudioContext = class extends Original { constructor(...args) { super(...args); resources.contexts.push(this); } };
    });
    let uploads = 0;
    await page.route('**/webhook/voz-agente', async route => {
      const body = route.request().postDataBuffer();
      assert.ok(body.includes(Buffer.from('RIFF')), 'automatic upload must contain valid WAV');
      assert.ok(body.length < 1500000, 'one utterance must remain bounded');
      uploads++;
      await route.fulfill({ status: 200, headers: { 'Content-Type': 'audio/wav', 'X-Transcripcion': encodeURIComponent('Hola, prueba de voz'), 'X-Respuesta': encodeURIComponent('Detección automática correcta.'), 'X-Fuentes': encodeURIComponent(JSON.stringify([{ title: 'Fuente de prueba', url: 'https://example.com/' }])) }, body: fs.readFileSync(speechFile) });
    });
    await page.goto('https://192.168.100.62:5678/webhook/voz');
    await page.waitForFunction(() => typeof document.getElementById('mic').onclick === 'function');
    await page.click('#mic');
    await page.waitForFunction(() => document.querySelectorAll('#log article').length >= 2, { timeout: 20000 });
    await page.waitForFunction(() => document.getElementById('player').getAttribute('src') === null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.__voiceResources.urls.size), 0, 'reply audio URL must be released after playback');
    await page.waitForFunction(() => document.querySelectorAll('#log article').length >= 4, { timeout: 20000 });
    assert.ok(uploads >= 2, 'automatic listening must resume after speaking');
    await page.click('#mic');
    await page.waitForFunction(() => window.__voiceResources.contexts.every(c => c.state === 'closed'));
    const resources = await page.evaluate(() => ({ urls: window.__voiceResources.urls.size, stopped: window.__voiceResources.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')) }));
    assert.equal(resources.urls, 0); assert.equal(resources.stopped, true);
    assert.deepEqual(errors, []);
    console.log('BROWSER_VAD_OK: automatic detection, silence upload, next turn, sources, audio release, microphone shutdown');
  } catch (error) {
    for (const ctx of browser?.contexts() || []) for (const page of ctx.pages()) {
      console.log(await page.evaluate(() => ({ status: document.getElementById('status')?.textContent, mic: document.getElementById('mic')?.dataset.state, contexts: window.__voiceResources?.contexts.map(c => c.state), level: document.getElementById('level')?.value, logs: document.getElementById('log')?.textContent })));
    }
    throw error;
  } finally { await browser?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
