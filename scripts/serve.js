const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3080;
const rootDir = path.resolve(__dirname, '..');

const mimeMap = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
};

http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const relPath = urlObj.pathname === '/' ? '/index.html' : urlObj.pathname;
  const fullPath = path.join(rootDir, decodeURIComponent(relPath));

  if (!fullPath.startsWith(rootDir) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
  fs.createReadStream(fullPath).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`3D Anime CG Interactive Viewer running at http://127.0.0.1:${PORT}`);
});
