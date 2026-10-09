// Read-only verification of the authenticated LAN UI and a real PTY command.
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
require('./lib/common').loadEnv();
const ca = fs.readFileSync('.runtime/tls/local-ca.crt');
const authorization = 'Basic ' + Buffer.from(process.env.TERMINAL_WEB_CREDENTIAL).toString('base64');
const host = '192.168.100.62';
async function request(path, authenticated = true) {
  return new Promise((resolve, reject) => {
    https.get({ hostname: host, port: 5678, path, ca, headers: authenticated ? { Authorization: authorization } : {} }, res => {
      let body = ''; res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}
async function main() {
  for (const path of ['/terminal/', '/trabajos', '/jobs']) {
    const denied = await request(path, false);
    if (denied.status !== 401) throw new Error(`${path}: authentication failed`);
    const allowed = await request(path);
    if (allowed.status !== 200) throw new Error(`${path}: HTTP ${allowed.status}`);
    console.log(`${path}: authentication OK`);
  }
  const token = JSON.parse((await request('/terminal/token')).body).token;
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${host}:5678/terminal/ws`, 'tty', { ca, headers: { Authorization: authorization, Origin: `https://${host}:5678` } });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('PTY timeout')); }, 15000);
    let sent = false;
    ws.on('open', () => ws.send(JSON.stringify({ AuthToken: token, columns: 80, rows: 24 })));
    ws.on('message', data => {
      const output = data.toString();
      if (!sent && output[0] === '0') {
        sent = true;
        ws.send(Buffer.from("0printf 'TERMINAL_%s\\n' WIFI_OK\r"));
      }
      if (output.includes('TERMINAL_WIFI_OK')) { clearTimeout(timer); ws.close(); console.log('Terminal PTY: TERMINAL_WIFI_OK'); resolve(); }
    });
    ws.on('error', error => { clearTimeout(timer); reject(error); });
  });
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
