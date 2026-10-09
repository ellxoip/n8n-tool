// Remove completed legacy voice execution data; other workflows are untouched.
const fs = require('fs');
require('./lib/common').loadEnv();
const root = (process.env.N8N_BASE_URL || 'http://127.0.0.1:5677') + '/api/v1';
const names = ['voz_agente.json','voz_tts.json','voz_interfaz.json'].map(file => JSON.parse(fs.readFileSync('workflows/' + file)).name);
async function api(method, endpoint) {
  const result = await fetch(root + endpoint, { method, headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY } });
  if (!result.ok) throw new Error('n8n HTTP ' + result.status);
  return result.json();
}
async function main() {
  const workflows = (await api('GET','/workflows?limit=250')).data.filter(wf => names.includes(wf.name));
  let removed = 0;
  for (const wf of workflows) {
    const details = await api('GET','/workflows/' + wf.id);
    if (details.settings.saveDataSuccessExecution !== 'none' || details.settings.saveDataErrorExecution !== 'none') throw new Error('Voice execution retention is still enabled');
    let cursor;
    do {
      const data = await api('GET','/executions?workflowId=' + wf.id + '&limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      for (const execution of data.data) if (execution.finished || ['success','error','canceled','crashed'].includes(execution.status)) {
        await api('DELETE','/executions/' + execution.id); removed++;
      }
      cursor = data.nextCursor;
    } while (cursor);
  }
  console.log('VOICE_RETENTION_OFF: legacy completed voice executions removed=' + removed);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
