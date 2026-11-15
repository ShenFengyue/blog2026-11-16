// 本地预览站点（构建产物 dist/）
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';

const ROOT = path.join(path.dirname(import.meta.dirname), 'dist');
const PORT = 4321;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.xml': 'application/xml; charset=utf-8' };

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let full = path.join(ROOT, p);
    if (!full.startsWith(ROOT)) { res.writeHead(403).end('403'); return; }
    try { if ((await stat(full)).isDirectory()) full = path.join(full, 'index.html'); } catch { /* 404 交给下面 */ }
    const body = await readFile(full).catch(() => null);
    if (!body) {
      const nf = await readFile(path.join(ROOT, '404.html')).catch(() => Buffer.from('404'));
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end(nf);
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(500).end('500');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`预览：http://127.0.0.1:${PORT}`);
  if (process.env.OPEN_BROWSER === '1') execFile('cmd', ['/c', 'start', '', `http://127.0.0.1:${PORT}`], () => {});
});
