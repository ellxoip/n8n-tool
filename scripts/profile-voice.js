require('./lib/common').loadEnv();
async function main() {
  const input = 'Explica brevemente qué es una red neuronal';
  const speech = await fetch('http://127.0.0.1:8000/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, response_format: 'wav' }) });
  const audio = await speech.blob();
  const form = new FormData(); form.append('file', audio, 'question.wav');
  let start = performance.now();
  const stt = await (await fetch('http://127.0.0.1:8000/v1/audio/transcriptions', { method: 'POST', body: form })).json();
  const sttMs = performance.now() - start; form.delete('file');
  start = performance.now();
  const answer = await (await fetch('http://127.0.0.1:8787/voice/answer', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.BRIDGE_TOKEN }, body: JSON.stringify({ transcript: stt.text, web: 'off' }) })).json();
  const modelMs = performance.now() - start;
  start = performance.now();
  const result = await fetch('http://127.0.0.1:8000/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: answer.message.content, response_format: 'wav' }) });
  await result.arrayBuffer();
  console.log(JSON.stringify({ sttSeconds: sttMs / 1000, modelSeconds: modelMs / 1000, ttsSeconds: (performance.now() - start) / 1000, transcript: stt.text, reply: answer.message.content }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
