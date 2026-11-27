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

  // Shopify /products.json endpoint simulation
  if (pathname === '/products.json') {
    const page = parseInt(reqUrl.searchParams.get('page') || '1', 10);
    if (page > 1) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ products: [] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      products: [
        {
          id: 101,
          title: 'Mechanical Keyboard v2',
          handle: 'mechanical-keyboard-v2',
          body_html: '<p>Ergonomic wireless keyboard</p>',
          vendor: 'KeyCorp',
          product_type: 'Electronics',
          tags: ['keyboard', 'wireless'],
          variants: [
            { id: 1001, title: 'Black / Linear', price: '129.99', sku: 'KB-BLK-LIN', available: true },
            { id: 1002, title: 'White / Tactile', price: '139.99', sku: 'KB-WHT-TAC', available: true }
          ],
          images: [{ src: 'http://127.0.0.1:3456/sample.png' }]
        }
      ]
    }));
    return;
  }

  // XML sitemap simulation endpoint
  if (pathname === '/sitemap.xml') {
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>http://127.0.0.1:3456/simple-grid.html</loc>
    <lastmod>2026-11-20</lastmod>
  </url>
  <url>
    <loc>http://127.0.0.1:3456/store-showcase.html</loc>
    <lastmod>2026-11-21</lastmod>
  </url>
</urlset>`);
    return;
  }

  // Delayed contact page endpoint for running status assertion in smoke tests
  if (pathname === '/slow-contact.html') {
    setTimeout(() => {
      const filePath = path.join(PAGES_DIR, 'v2-contact.html');
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(500);
          res.end('Error loading contact page');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    }, 800);
    return;
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

    // `?status=429` serves the page with that error status, as a site refusing requests does.
    const forced = Number(reqUrl.searchParams.get('status'));
    res.writeHead(forced >= 400 && forced < 600 ? forced : 200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    res.on('error', () => {});
    stream.pipe(res);
  });
});

server.on('error', (err) => {
  console.error('[Fixture Server Error]', err);
});

process.on('uncaughtException', (err) => {
  console.error('[Fixture Server Uncaught Exception]', err);
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
