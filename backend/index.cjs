const http = require('node:http');
const path = require('node:path');

const { createApi } = require('./runtime/api.cjs');
const { createFileStore } = require('./runtime/store.cjs');

const PORT = Number(process.env.PORT || 8788);
const DATA_PATH = process.env.DATA_PATH || path.join('/var/lib/slova', 'store.json');
const API_KEY = process.env.API_KEY || '';

const api = createApi({ store: createFileStore(DATA_PATH), apiKey: API_KEY });

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    try {
      const out = await api.handle({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: chunks.length ? Buffer.concat(chunks).toString('utf8') : '',
      });
      res.writeHead(out.status, out.headers);
      res.end(out.body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal', message: String(err && err.message) }));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`slova backend on 127.0.0.1:${PORT} data=${DATA_PATH}`);
});
