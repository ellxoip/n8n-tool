const http = require('http');

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); } catch { resolve({}); }
    });
  });
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

/** In-memory fake of the Ollama and Qdrant endpoints used by lib/memory. */
async function fakeBackends({ dimension = 4 } = {}) {
  const state = { collections: {}, embedCalls: 0 };
  const embedText = (text) => Array.from({ length: dimension }, (_, i) => ((text.charCodeAt(i % text.length) || 1) % 7) + i);

  const ollama = await listen(async (req, res) => {
    if (req.url === '/api/tags') return json(res, 200, { models: [{ name: 'nomic-embed-text:latest' }, { name: 'qwen3-coder:30b' }] });
    if (req.url === '/api/embed') {
      const body = await readBody(req);
      state.embedCalls += 1;
      return json(res, 200, { embeddings: body.input.map(embedText) });
    }
    return json(res, 404, {});
  });

  const qdrant = await listen(async (req, res) => {
    const match = req.url.match(/^\/collections\/([^/?]+)(\/points(\/search)?)?/);
    if (!match) return json(res, 404, {});
    const name = decodeURIComponent(match[1]);
    const body = await readBody(req);
    if (!match[2]) {
      if (req.method === 'GET') {
        const col = state.collections[name];
        return col ? json(res, 200, { result: { config: { params: { vectors: { size: col.size } } } } }) : json(res, 404, {});
      }
      state.collections[name] = { size: body.vectors.size, points: new Map() };
      return json(res, 200, { result: true });
    }
    const col = state.collections[name];
    if (!col) return json(res, 404, {});
    if (match[3]) {
      const hits = [...col.points.values()].map((p) => ({ score: 0.9, payload: p.payload })).slice(0, body.limit);
      return json(res, 200, { result: hits });
    }
    for (const point of body.points) col.points.set(point.id, point);
    return json(res, 200, { result: { status: 'completed' } });
  });

  return {
    state,
    ollamaUrl: ollama.url,
    qdrantUrl: qdrant.url,
    close: () => { ollama.server.close(); qdrant.server.close(); },
  };
}

module.exports = { listen, readBody, json, fakeBackends };
