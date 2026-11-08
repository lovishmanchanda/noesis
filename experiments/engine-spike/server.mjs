// Static server for the spike. Three origins so each experiment gets a clean browser cache and storage:
//   8080  cross-origin isolated, cacheable   (normal run, "warm" loads)
//   8081  NOT isolated, cacheable            (tests the no-SharedArrayBuffer fallback)
//   8082  cross-origin isolated, no-store    ("cold" loads)
// POST /save?name=x writes the request body to results/x.json (local use only).
// Usage: node server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = import.meta.dirname;
const allowed = ['harness', 'public', 'py', path.join('data', 'out')].map((d) => path.resolve(root, d) + path.sep);
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.wasm': 'application/wasm', '.csv': 'text/csv', '.py': 'text/x-python', '.zip': 'application/zip',
};
const modes = [
  { port: 8080, isolated: true, cache: true },
  { port: 8081, isolated: false, cache: true },
  { port: 8082, isolated: true, cache: false },
  { port: 8083, isolated: true, cache: true }, // fresh origin, same policy as 8080
];
fs.mkdirSync(path.join(root, 'results'), { recursive: true });

const handler = (mode) => (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/save') {
    const name = (url.searchParams.get('name') || 'result').replace(/[^\w.-]/g, '_');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      fs.writeFileSync(path.join(root, 'results', `${name}.json`), Buffer.concat(chunks));
      res.writeHead(200);
      res.end('ok');
    });
    return;
  }
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'harness/index.html';
  const file = path.resolve(root, rel);
  if (!allowed.some((a) => file.startsWith(a)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const headers = {
    'Content-Type': types[path.extname(file)] || 'application/octet-stream',
    'Content-Length': fs.statSync(file).size,
    // Only the Pyodide files are cacheable, so harness and Python edits are always picked up.
    'Cache-Control': mode.cache && rel.startsWith('public/') ? 'public, max-age=3600' : 'no-store',
  };
  if (mode.isolated) {
    headers['Cross-Origin-Opener-Policy'] = 'same-origin';
    headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
    headers['Cross-Origin-Resource-Policy'] = 'same-origin';
  }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
};

for (const m of modes) {
  http.createServer(handler(m)).listen(m.port, '127.0.0.1', () =>
    console.log(`http://localhost:${m.port}  isolated=${m.isolated} cache=${m.cache}`));
}
