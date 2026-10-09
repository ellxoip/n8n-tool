// One LAN port supports both existing HTTP links and HTTPS microphone access.
const fs = require('fs');
const http = require('http');
const polyglot = require('httpolyglot');
const path = require('path');
const crypto = require('crypto');
const { loadEnv, root } = require('../../scripts/lib/common');
loadEnv();

function createGateway({ upstreamPort, key, cert, ca }) {
  const privatePath = value => /^\/(terminal(?:\/|$)|trabajos(?:\/|$)|jobs(?:\/|$))/.test(value);
  function authorize(req, res) {
    if (!privatePath(req.url)) return true;
    if (!req.socket.encrypted) {
      const target = req.headers.host || '192.168.100.62:5678';
      res.writeHead(308, { Location: `https://${target}${req.url}` }); res.end(); return false;
    }
    const expected = process.env.TERMINAL_WEB_CREDENTIAL;
    const actual = (req.headers.authorization || '').replace(/^Basic /, '');
    const hash = input => crypto.createHash('sha256').update(input).digest();
    if (!expected || !crypto.timingSafeEqual(hash(actual), hash(Buffer.from(expected).toString('base64')))) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Terminal del notebook"' }); res.end('Inicia sesion con tus credenciales locales.'); return false;
    }
    if (req.headers.origin && req.headers.origin !== `https://${req.headers.host}`) {
      res.writeHead(403); res.end('Origen no permitido.'); return false;
    }
    return true;
  }
  function proxy(req, res) {
    if (!authorize(req, res)) return;
    if (req.method === 'GET' && req.url === '/local-ca.crt') {
      res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="Carlos-IA-Local.crt"' });
      return res.end(ca);
    }
    if (req.method === 'GET' && req.url === '/trabajos') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(root, 'services', 'jobs', 'phone.html')));
    }
    const isTerminal = /^\/terminal(?:\/|$)/.test(req.url);
    const isJobs = /^\/jobs(?:\/|$)/.test(req.url);
    const isVoiceAsset = req.url.startsWith('/voz-assets/');
    // Serve our trusted local page directly. n8n sandboxes webhook HTML with an
    // opaque origin, which blocks microphone permission and ES module imports.
    const isVoicePage = req.method === 'GET' && req.url.split('?')[0] === '/webhook/voz';
    const upstream = http.request({ host: '127.0.0.1', port: isTerminal ? 7681 : isJobs ? 8787 : isVoiceAsset || isVoicePage ? 8000 : upstreamPort, path: isVoicePage ? '/page' : isVoiceAsset ? req.url.replace('/voz-assets/', '/assets/') : req.url, method: req.method,
      headers: { ...req.headers, ...(isJobs ? { authorization: `Bearer ${process.env.BRIDGE_TOKEN}` } : {}), 'x-forwarded-proto': req.socket.encrypted ? 'https' : 'http', 'x-forwarded-host': req.headers.host, 'x-forwarded-for': req.socket.remoteAddress } }, response => {
      if (req.socket.encrypted && req.method === 'GET' && req.url.split('?')[0].endsWith('/chat') && String(response.headers['content-type']).includes('text/html')) {
        let html = '';
        response.setEncoding('utf8');
        response.on('data', chunk => html += chunk);
        response.on('end', () => {
          const publicUrl = new URL(process.env.WEBHOOK_URL || 'http://192.168.100.62:5678');
          html = html.split(publicUrl.origin).join(`https://${req.headers.host}`);
          const headers = { ...response.headers, 'content-length': Buffer.byteLength(html) };
          delete headers['transfer-encoding'];
          res.writeHead(response.statusCode, headers); res.end(html);
        });
      } else {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      }
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('n8n esta iniciando. Reintenta en unos segundos.'); });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
    req.pipe(upstream);
  }
  function upgrade(req, socket, head) {
    if (privatePath(req.url)) {
      const expected = process.env.TERMINAL_WEB_CREDENTIAL;
      const supplied = req.headers.authorization || '';
      if (!req.socket.encrypted || !expected || supplied !== `Basic ${Buffer.from(expected).toString('base64')}` || (req.headers.origin && req.headers.origin !== `https://${req.headers.host}`)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return;
      }
    }
    const upstream = http.request({ host: '127.0.0.1', port: /^\/terminal(?:\/|$)/.test(req.url) ? 7681 : upstreamPort, path: req.url, headers: req.headers });
    upstream.on('upgrade', (res, target, extra) => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(res.headers).map(([k,v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if (head.length) target.write(head);
      if (extra.length) socket.write(extra);
      socket.pipe(target).pipe(socket);
      target.on('error', () => socket.destroy());
      socket.on('error', () => target.destroy());
    });
    upstream.on('response', () => socket.destroy());
    upstream.on('error', () => socket.destroy());
    upstream.end();
  }
  const server = polyglot.createServer({ key, cert }, proxy);
  server.on('upgrade', upgrade);
  return server;
}

if (require.main === module) {
  const directory = path.join(root, '.runtime', 'tls');
  createGateway({ upstreamPort: Number(process.env.N8N_PORT || 5677), key: fs.readFileSync(path.join(directory, 'server.key')), cert: fs.readFileSync(path.join(directory, 'server.crt')), ca: fs.readFileSync(path.join(directory, 'local-ca.crt')) })
    .listen(5678, '0.0.0.0', () => console.log('HTTP + HTTPS gateway ready on LAN port 5678'));
}
module.exports = { createGateway };
