// @ts-check
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3456;
const PAGES_DIR = path.resolve(__dirname, 'pages');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  // Normalize URL
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  let pathname = reqUrl.pathname;

  if (pathname === '/') {
    pathname = '/simple-grid.html';
  }

  // JSON API simulation endpoint for delayed or dynamic tests
  if (pathname === '/api/delayed-products') {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        products: [
          { id: 'api-1', name: 'Server Stream Item 1', price: 99.99 },
          { id: 'api-2', name: 'Server Stream Item 2', price: 149.99 }
        ]
      }));
    }, 1000);
    return;
  }

  const filePath = path.join(PAGES_DIR, pathname.replace(/^\//, ''));

  // Security check: ensure path is within PAGES_DIR
  if (!filePath.startsWith(PAGES_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`404 Not Found: ${pathname}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[PageHarvest Fixture Server] Running at http://127.0.0.1:${PORT}/`);
});

// Graceful termination handling
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
