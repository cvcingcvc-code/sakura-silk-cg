const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const job = process.argv[2] || 'preview'; // 'preview' | 'video'
const res = parseInt(process.argv[3] || (job === 'preview' ? '1024' : '1080'), 10);
const startFrame = parseInt(process.argv[4] || '0', 10);

const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'output');
const framesDir = path.join(outDir, 'frames');
fs.mkdirSync(framesDir, { recursive: true });

const mimeMap = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

let chromeProc = null;

const server = http.createServer((req, resHttp) => {
  const urlObj = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'POST' && urlObj.pathname === '/log-error') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      console.error('[BROWSER ERROR]', Buffer.concat(chunks).toString('utf8'));
      resHttp.writeHead(200);
      resHttp.end('ok');
    });
    return;
  }

  if (req.method === 'POST' && urlObj.pathname === '/save-frame') {
    const name = path.basename(urlObj.searchParams.get('name') || 'frame.png');
    const targetDir = name.startsWith('frame_') ? framesDir : outDir;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      fs.writeFileSync(path.join(targetDir, name), buf);
      if (!name.startsWith('frame_') || name.endsWith('00.jpg') || name.endsWith('48.jpg') || name.endsWith('96.jpg') || name.endsWith('144.jpg') || name.endsWith('191.jpg')) {
        console.log(`Saved ${name} (${(buf.length / 1024).toFixed(1)} KB)`);
      }
      resHttp.writeHead(200);
      resHttp.end('saved');
    });
    return;
  }

  if (req.method === 'POST' && urlObj.pathname === '/job-complete') {
    console.log(`Render job "${job}" finished in WebGL!`);
    resHttp.writeHead(200);
    resHttp.end('done');
    setTimeout(() => finalizeAndExit(), 200);
    return;
  }

  // Serve static files
  let relPath = urlObj.pathname === '/' ? '/index.html' : urlObj.pathname;
  const fullPath = path.join(rootDir, decodeURIComponent(relPath));
  if (!fullPath.startsWith(rootDir) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    resHttp.writeHead(404);
    resHttp.end('Not found');
    return;
  }
  const ext = path.extname(fullPath).toLowerCase();
  resHttp.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
  fs.createReadStream(fullPath).pipe(resHttp);
});

function resolveExecutable(envVar, cmdName, candidates) {
  if (process.env[envVar] && fs.existsSync(process.env[envVar])) {
    return process.env[envVar];
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return cmdName;
}

function findWingetFfmpeg() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const wingetPkgDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(wingetPkgDir)) return null;
  for (const entry of fs.readdirSync(wingetPkgDir)) {
    if (entry.toLowerCase().includes('ffmpeg')) {
      const sub = path.join(wingetPkgDir, entry);
      for (const child of fs.readdirSync(sub)) {
        const candidate = path.join(sub, child, 'bin', 'ffmpeg.exe');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function finalizeAndExit() {
  if (chromeProc) {
    try { chromeProc.kill(); } catch (_) {}
  }
  server.close(() => {
    if (job === 'video') {
      console.log('Encoding 8s 24fps MP4 via FFmpeg...');
      const ffmpegPath = resolveExecutable('FFMPEG_PATH', 'ffmpeg', [findWingetFfmpeg()]);
      const mp4Out = path.join(outDir, 'anime_3d_cg_8s_24fps.mp4');
      execFileSync(ffmpegPath, [
        '-y',
        '-framerate', '24',
        '-i', path.join(framesDir, 'frame_%04d.jpg'),
        '-c:v', 'libx264',
        '-preset', 'slow',
        '-crf', '16',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        mp4Out,
      ], { stdio: 'inherit' });
      console.log('MP4 encoded successfully:', mp4Out);
    }
    process.exit(0);
  });
}

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/?job=${job}&res=${res}&start=${startFrame}`;
  console.log(`Server listening on ${url}`);

  const chromePath = resolveExecutable('CHROME_PATH', 'google-chrome', [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]);
  const userDataDir = path.join(outDir, '.chrome_headless_profile');
  fs.mkdirSync(userDataDir, { recursive: true });

  chromeProc = spawn(chromePath, [
    '--headless=new',
    '--use-angle=d3d11',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    `--user-data-dir=${userDataDir}`,
    `--window-size=${res + 100},${res + 100}`,
    '--no-first-run',
    '--no-default-browser-check',
    url,
  ], { stdio: 'ignore' });
});

setTimeout(() => {
  console.error('Timeout waiting for render job!');
  if (chromeProc) try { chromeProc.kill(); } catch (_) {}
  process.exit(1);
}, 600000);
