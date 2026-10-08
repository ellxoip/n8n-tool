const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.js', '.ts', '.tsx', '.jsx', '.py', '.gd', '.html', '.css',
  '.yml', '.yaml', '.toml', '.sh', '.bat', '.ps1', '.sql', '.csv', '.cs', '.go', '.rs', '.java',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', '.runtime', 'dist', 'build', '.godot', '__pycache__']);
const MAX_FILE_BYTES = 512 * 1024;

function settings(overrides = {}) {
  return {
    ollamaBase: (overrides.ollamaBase || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, ''),
    qdrantBase: (overrides.qdrantBase || process.env.QDRANT_URL || 'http://localhost:6333').replace(/\/$/, ''),
    qdrantKey: overrides.qdrantKey ?? process.env.QDRANT_API_KEY ?? '',
    collection: overrides.collection || process.env.QDRANT_COLLECTION || 'n8n_team_memory',
    embedModel: overrides.embedModel || process.env.OLLAMA_MODEL_EMBEDDING || 'nomic-embed-text:latest',
  };
}

async function jsonFetch(url, options = {}, label = url) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new Error(`${label} no responde (${err.cause?.code || err.message})`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

function qdrantHeaders(cfg) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.qdrantKey) headers['api-key'] = cfg.qdrantKey;
  return headers;
}

async function embed(texts, cfg) {
  const res = await jsonFetch(`${cfg.ollamaBase}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cfg.embedModel, input: texts }),
  }, 'Ollama');
  if (!res.ok || !Array.isArray(res.data?.embeddings)) {
    const detail = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    throw new Error(`Embeddings fallaron con ${cfg.embedModel} (HTTP ${res.status}): ${String(detail).slice(0, 200)}. Ejecuta: ollama pull ${cfg.embedModel}`);
  }
  return res.data.embeddings;
}

// Paragraph-aware chunking with overlap so context is not cut mid-idea.
function chunkText(text, { size = 1200, overlap = 200 } = {}) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks = [];
  let current = '';
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = current.slice(Math.max(0, current.length - overlap));
  };

  for (const paragraph of clean.split(/\n{2,}/)) {
    let rest = paragraph;
    while (rest.length > size) {
      if (current.length + 1 > size) flush();
      const room = Math.max(size - current.length, 1);
      current += (current ? '\n' : '') + rest.slice(0, room);
      rest = rest.slice(room);
      flush();
    }
    if (current.length + rest.length + 2 > size) flush();
    current += (current ? '\n\n' : '') + rest;
  }
  if (current.trim() && current.trim() !== chunks[chunks.length - 1]) chunks.push(current.trim());
  return chunks;
}

// Deterministic UUID so re-ingesting the same text overwrites instead of duplicating.
function pointId(source, index, chunk) {
  const hex = crypto.createHash('sha1').update(`${source}\u0000${index}\u0000${chunk}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function ensureCollection(cfg, dimension) {
  const url = `${cfg.qdrantBase}/collections/${encodeURIComponent(cfg.collection)}`;
  const existing = await jsonFetch(url, { headers: qdrantHeaders(cfg) }, 'Qdrant');
  if (existing.ok) {
    const size = existing.data?.result?.config?.params?.vectors?.size;
    if (size && size !== dimension) {
      throw new Error(`La coleccion ${cfg.collection} usa vectores de ${size} dimensiones pero ${cfg.embedModel} produce ${dimension}. Usa otra coleccion (QDRANT_COLLECTION) o el mismo modelo de embeddings.`);
    }
    return;
  }
  if (existing.status !== 404) {
    throw new Error(`Qdrant respondio HTTP ${existing.status} al consultar la coleccion.`);
  }
  const created = await jsonFetch(url, {
    method: 'PUT',
    headers: qdrantHeaders(cfg),
    body: JSON.stringify({ vectors: { size: dimension, distance: 'Cosine' } }),
  }, 'Qdrant');
  if (!created.ok) throw new Error(`No pude crear la coleccion ${cfg.collection} (HTTP ${created.status}).`);
}

async function ingestText({ text, source = 'manual', metadata = {} }, overrides = {}) {
  const cfg = settings(overrides);
  const chunks = chunkText(text);
  if (!chunks.length) return { collection: cfg.collection, source, chunks: 0 };

  const vectors = [];
  for (let i = 0; i < chunks.length; i += 16) {
    vectors.push(...await embed(chunks.slice(i, i + 16), cfg));
  }
  await ensureCollection(cfg, vectors[0].length);

  const points = chunks.map((chunk, index) => ({
    id: pointId(source, index, chunk),
    vector: vectors[index],
    payload: { text: chunk, source, chunk: index, ingestedAt: new Date().toISOString(), ...metadata },
  }));
  const res = await jsonFetch(
    `${cfg.qdrantBase}/collections/${encodeURIComponent(cfg.collection)}/points?wait=true`,
    { method: 'PUT', headers: qdrantHeaders(cfg), body: JSON.stringify({ points }) },
    'Qdrant',
  );
  if (!res.ok) throw new Error(`Qdrant rechazo el upsert (HTTP ${res.status}): ${JSON.stringify(res.data).slice(0, 200)}`);
  return { collection: cfg.collection, source, chunks: chunks.length };
}

async function search({ query, limit = 5 }, overrides = {}) {
  const cfg = settings(overrides);
  if (!String(query || '').trim()) throw new Error('Falta la consulta.');
  const [vector] = await embed([query], cfg);
  const res = await jsonFetch(
    `${cfg.qdrantBase}/collections/${encodeURIComponent(cfg.collection)}/points/search`,
    {
      method: 'POST',
      headers: qdrantHeaders(cfg),
      body: JSON.stringify({ vector, limit: Math.min(Math.max(Number(limit) || 5, 1), 20), with_payload: true }),
    },
    'Qdrant',
  );
  if (res.status === 404) return { collection: cfg.collection, results: [] };
  if (!res.ok) throw new Error(`Busqueda fallo (HTTP ${res.status}): ${JSON.stringify(res.data).slice(0, 200)}`);
  return {
    collection: cfg.collection,
    results: (res.data?.result || []).map((hit) => ({
      score: Number(hit.score.toFixed(4)),
      source: hit.payload?.source,
      text: hit.payload?.text,
    })),
  };
}

function* walkFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    yield target;
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walkFiles(path.join(target, entry.name));
    } else if (entry.isFile()) {
      yield path.join(target, entry.name);
    }
  }
}

async function ingestPath(target, overrides = {}, onFile = () => {}) {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) throw new Error(`No existe: ${resolved}`);
  const base = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  const summary = { files: 0, chunks: 0, skipped: 0 };
  for (const file of walkFiles(resolved)) {
    const tooBig = fs.statSync(file).size > MAX_FILE_BYTES;
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()) || tooBig) {
      summary.skipped += 1;
      continue;
    }
    const source = path.relative(base, file).split(path.sep).join('/') || path.basename(file);
    const result = await ingestText({ text: fs.readFileSync(file, 'utf8'), source }, overrides);
    summary.files += 1;
    summary.chunks += result.chunks;
    onFile(source, result.chunks);
  }
  return summary;
}

module.exports = { settings, chunkText, pointId, embed, ingestText, ingestPath, search };
