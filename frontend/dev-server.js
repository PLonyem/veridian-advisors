/**
 * Local dev server: serves this directory as static files AND proxies
 * /api/* to the backend, so relative fetch URLs in the frontend code
 * (e.g. main.js's fetch('/api/submit-lead')) resolve correctly even though
 * the frontend and backend are two separate processes on two different
 * ports in development. This makes local dev behave like production
 * ("frontend and backend on same domain") instead of relying on CORS to
 * bridge two different origins - a more faithful test of the real request
 * path, and it means main.js needs zero environment-specific branching.
 *
 * No dependencies beyond Node's own http module - deliberately not pulling
 * in Express/http-proxy-middleware for something this small.
 *
 * Usage:
 *   node dev-server.js                    # serves on :3000, proxies to :5000
 *   PORT=3001 BACKEND_URL=http://localhost:5050 node dev-server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.xml': 'application/xml; charset=UTF-8',
  '.txt': 'text/plain; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const filePath = path.normalize(path.join(ROOT, urlPath));

  // Reject anything that resolves outside ROOT (path traversal via ../).
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + urlPath);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function proxyToBackend(req, res) {
  const target = new URL(req.url, BACKEND_URL);
  const proxyReq = http.request(
    target,
    { method: req.method, headers: Object.assign({}, req.headers, { host: target.host }) },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    },
  );

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Bad Gateway',
      message: `Backend not reachable at ${BACKEND_URL} (${err.message}). Is it running? (cd ../veridian-backend && npm run dev)`,
    }));
  });

  req.pipe(proxyReq, { end: true });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    proxyToBackend(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`Frontend dev server: http://localhost:${PORT}`);
  console.log(`Proxying /api/* -> ${BACKEND_URL}`);
});
