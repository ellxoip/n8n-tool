// End-to-end verification in an isolated local workspace, using the real coder.
const https = require('https');
const fs = require('fs');
require('./lib/common').loadEnv();
const ca = fs.readFileSync('.runtime/tls/local-ca.crt');
const authorization = 'Basic ' + Buffer.from(process.env.TERMINAL_WEB_CREDENTIAL).toString('base64');
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: '192.168.100.62', port: 5678, path, method, ca, headers: { Authorization: authorization, 'Content-Type': 'application/json' } }, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => { if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data}`)); resolve(JSON.parse(data)); });
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}
async function main() {
  const file = 'workspace/lan-approval-smoke/PHONE_APPROVAL_OK.txt';
  if (fs.existsSync(file)) throw new Error('Verification already performed; use a new isolated workspace.');
  const job = await request('POST', '/jobs', { workspace: 'lan-approval-smoke', task: 'Crea exclusivamente el archivo PHONE_APPROVAL_OK.txt en el directorio actual con una sola linea: PHONE_APPROVAL_OK. No crees scripts ni cambies otros archivos. Termina al crearlo.' });
  if (job.status !== 'pending_approval' || fs.existsSync(file)) throw new Error('Execution started without approval');
  console.log(`Pending approval verified: ${job.id}`);
  await request('POST', `/jobs/${job.id}/approve`, {});
  let previous = '';
  for (let attempt = 0; attempt < 125; attempt++) {
    const current = await request('GET', `/jobs/${job.id}`);
    if (current.status !== previous || attempt % 6 === 0) {
      console.log(`Job: ${current.status}; progress: ${(current.progress || '').length} characters`); previous = current.status;
    }
    if (current.status === 'awaiting_review') {
      if (fs.readFileSync(file, 'utf8').trim() !== 'PHONE_APPROVAL_OK') throw new Error('Unexpected file content');
      const accepted = await request('POST', `/jobs/${job.id}/accept`, {});
      if (accepted.status !== 'completed') throw new Error('Acceptance failed');
      console.log(`APPROVAL_TO_REVIEW_OK: ${current.result.seconds}s`); return;
    }
    if (['failed', 'interrupted'].includes(current.status)) throw new Error(JSON.stringify(current.result || current.error));
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error('Approval verification timed out');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
