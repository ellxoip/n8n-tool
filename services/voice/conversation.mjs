import { VoiceDetector, encodeWav } from './vad-core.mjs';
const $ = id => document.getElementById(id), player = $('player');
const direct = Boolean(navigator.mediaDevices?.getUserMedia && window.AudioWorkletNode);
const newSession = () => window.crypto?.randomUUID?.() || `voice-${Date.now()}`;
let session = newSession();
try { session = localStorage.getItem('carlos-voice-session') || session; localStorage.setItem('carlos-voice-session', session); } catch {}
try { $('city').value = localStorage.getItem('carlos-voice-city') || ''; } catch {}
$('city').addEventListener('change', () => { try { localStorage.setItem('carlos-voice-city', $('city').value.trim()); } catch {} });
let enabled = false, starting = false, busy = false, listening = false, generation = 0;
let stream, context, source, sampler, silentOutput, detector, wakeLock;
let controller, playbackUrl, resumeTimer, lastMeter = 0, lastState = '';
function status(text, state = '') {
  if ($('status').textContent !== text) $('status').textContent = text;
  if (state) $('mic').dataset.state = state;
}
function controls() {
  $('send').disabled = busy; $('attach').disabled = busy;
  $('mic').textContent = enabled || starting ? '⏸️ Pausar conversación' : direct ? '🎙️ Activar conversación' : '🎙️ Adjuntar una grabación';
  $('mic').setAttribute('aria-pressed', String(enabled));
}
function line(who, text) {
  const article = document.createElement('article'), heading = document.createElement('strong');
  heading.textContent = who + '\n'; article.append(heading, document.createTextNode(text.slice(0, 4000)));
  $('log').prepend(article);
  while ($('log').children.length > 30) $('log').lastElementChild.remove();
  return article;
}
function releasePlayback() {
  player.pause(); player.removeAttribute('src'); player.load();
  if (playbackUrl) { URL.revokeObjectURL(playbackUrl); playbackUrl = undefined; }
}
function pauseCapture() {
  listening = false; clearTimeout(resumeTimer);
  sampler?.port.postMessage({ enabled: false }); detector?.reset();
  stream?.getAudioTracks().forEach(track => track.enabled = false);
  if (context?.state === 'running') context.suspend().catch(() => {});
  $('level').value = 0;
}
async function arm() {
  if (!enabled || busy || playbackUrl || document.hidden || !context) return;
  const turn = generation;
  detector = new VoiceDetector({ silenceMs: Number($('silence').value), sensitivity: Number($('sensitivity').value) });
  try {
    await context.resume();
    if (turn !== generation || !enabled || busy || playbackUrl) return;
    stream.getAudioTracks().forEach(track => track.enabled = true);
    sampler.port.postMessage({ enabled: true }); listening = true; lastState = '';
    status('Ajustando el micrófono… espera un instante.', 'listening');
  } catch { await stopConversation('El navegador pausó el audio. Vuelve a activar la conversación.'); }
}
function resumeAfterReply() {
  clearTimeout(resumeTimer);
  if (enabled) {
    status('Preparando el micrófono para tu siguiente pregunta…', 'listening');
    resumeTimer = setTimeout(arm, 350);
  } else status('Listo. Activa la conversación para hablar.', 'off');
}
async function stopConversation(message = 'Conversación pausada. El micrófono está apagado.') {
  generation++; enabled = false; starting = false; controller?.abort(); controller = undefined; busy = false;
  pauseCapture(); releasePlayback();
  if (sampler) { sampler.port.onmessage = null; sampler.port.close(); sampler.disconnect(); }
  source?.disconnect(); silentOutput?.disconnect(); stream?.getTracks().forEach(track => track.stop());
  const previous = context; context = stream = source = sampler = silentOutput = detector = undefined;
  if (previous && previous.state !== 'closed') await previous.close().catch(() => {});
  if (wakeLock) { await wakeLock.release().catch(() => {}); wakeLock = undefined; }
  controls(); status(message, 'off');
}
async function startConversation() {
  if (!direct) { $('capture').click(); return; }
  if (busy) { status('Espera la respuesta o pulsa Interrumpir respuesta.'); return; }
  starting = true; controls(); const turn = ++generation;
  releasePlayback(); status('Solicitando permiso de micrófono…', 'listening');
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const nextContext = new AudioContextClass({ latencyHint: 'interactive' }); context = nextContext;
    await nextContext.resume();
    const nextStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
    if (turn !== generation) { nextStream.getTracks().forEach(track => track.stop()); if (nextContext.state !== 'closed') await nextContext.close(); return; }
    stream = nextStream;
    await nextContext.audioWorklet.addModule(new URL('./voice-worklet.js', import.meta.url));
    if (turn !== generation) return;
    source = nextContext.createMediaStreamSource(stream); sampler = new AudioWorkletNode(nextContext, 'voice-sampler');
    silentOutput = nextContext.createGain(); silentOutput.gain.value = 0;
    source.connect(sampler); sampler.connect(silentOutput); silentOutput.connect(nextContext.destination);
    sampler.port.onmessage = event => {
      if (!listening || busy || !enabled || document.hidden) return;
      const result = detector.push(event.data);
      if (performance.now() - lastMeter > 100) { $('level').value = Math.min(1, result.level * 12); lastMeter = performance.now(); }
      if (result.state === 'recording') status(`Te escucho… ${Math.floor(result.durationMs / 1000)} s. Haz una pausa para enviar.`, 'recording');
      else if (result.state === 'listening' && lastState !== 'listening') status('Te escucho. Habla cuando quieras.', 'listening');
      else if (result.state === 'complete') {
        pauseCapture();
        const blob = new Blob([encodeWav(result.frames, result.trimSamples)], { type: 'audio/wav' });
        result.frames.length = 0; sendBlob(blob);
      } else if (result.state === 'discarded') status('Te escucho. No envié el sonido breve.', 'listening');
      lastState = result.state;
    };
    stream.getAudioTracks().forEach(track => track.onended = () => { if (enabled) stopConversation('Se desconectó el micrófono. Activa la conversación otra vez.'); });
    starting = false; enabled = true; controls();
    try { if (navigator.wakeLock && !document.hidden) wakeLock = await navigator.wakeLock.request('screen'); } catch {}
    if (turn !== generation) { if (wakeLock) { await wakeLock.release().catch(() => {}); wakeLock = undefined; } return; }
    await arm();
  } catch (error) {
    if (turn !== generation) return;
    await stopConversation(error.name === 'NotAllowedError' ? 'Permite el micrófono para conversar. También puedes adjuntar un audio.' : 'No se pudo activar el micrófono. Revisa HTTPS o adjunta un audio.');
  }
}
function decoded(res, key) { try { return decodeURIComponent(res.headers.get(key) || ''); } catch { return ''; } }
async function submit(payload) {
  if (busy) { if (payload instanceof FormData) payload.delete('file'); return; }
  pauseCapture(); releasePlayback(); busy = true; controls();
  status($('web').value === 'off' ? 'Pregunta enviada. La IA está pensando…' : 'Procesando la pregunta y consultando información cuando corresponde…', 'processing');
  const turn = generation, begin = performance.now(), abort = new AbortController(); controller = abort;
  const timeout = setTimeout(() => abort.abort(), 150000); let waitingForPlayback = false;
  try {
    const opts = { method: 'POST', signal: abort.signal, cache: 'no-store' };
    if (payload instanceof FormData) { payload.set('sessionId', session); payload.set('web', $('web').value); payload.set('city', $('city').value.trim()); opts.body = payload; }
    else { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify({ text: payload, sessionId: session, web: $('web').value, city: $('city').value.trim() }); }
    const res = await fetch('/webhook/voz-agente', opts);
    if (!res.ok || !(res.headers.get('content-type') || '').includes('audio/')) {
      const detail = (await res.text()).slice(0, 240);
      throw new Error(res.status === 429 ? 'La voz está ocupada. Espera un momento y vuelve a hablar.' : detail || 'No se obtuvo una respuesta. Vuelve a intentar.');
    }
    const blob = await res.blob(); if (turn !== generation || abort.signal.aborted) return;
    const transcript = decoded(res, 'X-Transcripcion'), reply = decoded(res, 'X-Respuesta');
    if (transcript) line('Tú', transcript);
    const article = reply ? line('IA', reply) : null;
    try {
      for (const item of JSON.parse(decoded(res, 'X-Fuentes') || '[]')) {
        const url = new URL(item.url); if (!['https:', 'http:'].includes(url.protocol) || !article) continue;
        const link = document.createElement('a'); link.href = url.href; link.textContent = '\nFuente: ' + item.title;
        link.target = '_blank'; link.rel = 'noopener noreferrer'; article.append(link);
      }
    } catch {}
    const webStatus = decoded(res, 'X-Web-Estado');
    try {
      const memory = JSON.parse(decoded(res, 'X-Memoria') || '{}');
      $('memory').textContent = [memory.topic ? 'Tema: ' + memory.topic : '', memory.place ? 'Lugar: ' + memory.place : '', memory.turns ? 'Memoria: ' + memory.turns + ' intercambios' : ''].filter(Boolean).join(' · ');
    } catch {}
    if (webStatus === 'unavailable') line('Consulta web', 'No pude consultar fuentes ahora. La respuesta no está verificada en Internet.');
    playbackUrl = URL.createObjectURL(blob); player.src = playbackUrl; waitingForPlayback = true;
    status(`La IA responde · ${((performance.now() - begin) / 1000).toFixed(1)} s.`, 'speaking');
    try { await player.play(); } catch { status('Respuesta lista. Pulsa ▶ para escuchar; después puedes seguir hablando.', 'speaking'); }
  } catch (error) {
    if (turn !== generation) return;
    status(error.name === 'AbortError' ? 'Se agotó la espera. Intenta una pregunta más corta.' : `No se pudo responder: ${error.message}`, 'off');
  } finally {
    clearTimeout(timeout); if (payload instanceof FormData) payload.delete('file'); payload = null;
    if (turn === generation) {
      controller = undefined; busy = false; controls();
      if (!waitingForPlayback && enabled) resumeTimer = setTimeout(arm, 1800);
    }
  }
}
function sendBlob(blob) {
  if (blob.size > 8 * 1024 * 1024) { status('El audio supera 8 MB. Usa una grabación más corta.'); resumeAfterReply(); return; }
  const form = new FormData(); form.append('file', blob, `pregunta.${blob.type.includes('wav') ? 'wav' : blob.type.includes('mp4') ? 'm4a' : 'webm'}`); submit(form);
}
player.addEventListener('ended', () => { releasePlayback(); resumeAfterReply(); });
player.addEventListener('error', () => { if (playbackUrl) { releasePlayback(); status('No se pudo reproducir la voz. La respuesta está escrita abajo.'); if (enabled) resumeTimer = setTimeout(arm, 1500); } });
player.addEventListener('play', pauseCapture);
$('mic').onclick = () => enabled || starting ? stopConversation() : startConversation();
$('stop').onclick = () => { generation++; controller?.abort(); controller = undefined; busy = false; pauseCapture(); releasePlayback(); controls(); resumeAfterReply(); };
$('reset').onclick = async () => { await stopConversation('Nueva conversación. Activa el micrófono para empezar.'); session = newSession(); try { localStorage.setItem('carlos-voice-session', session); } catch {} $('log').replaceChildren(); $('memory').textContent = ''; };
$('send').onclick = () => { const text = $('text').value.trim(); if (text && !busy) { $('text').value = ''; submit(text); } };
$('attach').onclick = () => { if (!busy) $('capture').click(); };
$('capture').onchange = () => { const file = $('capture').files[0]; if (file) sendBlob(file); $('capture').value = ''; };
for (const name of ['sensitivity', 'silence']) $(name).onchange = () => { if (listening && !detector?.active) { pauseCapture(); arm(); } };
document.addEventListener('visibilitychange', () => { if (document.hidden) stopConversation('Conversación pausada al salir de la pantalla. Actívala para continuar.'); });
window.addEventListener('pagehide', () => stopConversation());
if (!direct) { $('secure').hidden = false; $('https').href = `https://${location.host}${location.pathname}`; $('hint').textContent = 'Abre HTTPS e instala el certificado para activar la detección automática. Aquí puedes adjuntar un audio o dictar con el teclado.'; controls(); }
