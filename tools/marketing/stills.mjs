// Genera las imágenes de marketing con marketing.html (misma técnica que el tráiler).
// Uso: node stills.mjs <carpeta del juego> <carpeta de trabajo> <carpeta de salida>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const [GAME, DIR, OUTDIR] = process.argv.slice(2);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const STUB = '<head><script>window.__raf=null;window.requestAnimationFrame=(cb)=>{window.__raf=cb};' +
  'try{localStorage.clear()}catch(e){};' +
  'window.addEventListener("blur",(e)=>e.stopImmediatePropagation(),true);' +
  'document.addEventListener("visibilitychange",(e)=>e.stopImmediatePropagation(),true);</script>';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
// Un cuarto argumento opcional genera solo esa imagen (p. ej. "cover")
const ONLY = process.argv[5];
const IMAGES = [
  ['01-poster', 'key', 1920, 1080, 960, 540],
  ['02-goles-de-fuego', 'fire', 1920, 1080, 1280, 720],
  ['03-roguelike-dragon', 'rogue', 1920, 1080, 1280, 720],
  ['04-krostnoid-vertical', 'knoid', 1080, 1920, 540, 960],
  ['05-pista-de-hielo-vertical', 'ice', 1080, 1920, 540, 960],
  ['itchio-cover', 'cover', 1260, 1000, 960, 540], // 630x500 recomendado por itch.io, a doble resolución
].filter(([, img]) => !ONLY || img === ONLY);

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = url.startsWith('/game/') ? path.join(GAME, url.slice(6)) : path.join(DIR, url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(file);
  if (url === '/game/index.html') body = Buffer.from(body.toString('utf8').replace('<head>', STUB));
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
}).listen(8766);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUTDIR, { recursive: true });

for (const [name, img, w, h, gw, gh] of IMAGES) {
  const url = `http://127.0.0.1:8766/marketing.html?img=${img}&w=${w}&h=${h}&gw=${gw}&gh=${gh}`;
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9334',
    `--user-data-dir=${path.join(DIR, 'profile-stills')}`, `--window-size=${Math.max(w, gw)},${Math.max(h, gh)}`, url]);
  let ws = null;
  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      await sleep(250);
      try { target = (await (await fetch('http://127.0.0.1:9334/json/list')).json()).find((t) => t.type === 'page' && t.url.includes('marketing')); } catch (_) { /* arrancando */ }
    }
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0;
    const call = (expression) => new Promise((resolve) => {
      const my = ++id;
      const onMsg = (e) => { const m = JSON.parse(e.data); if (m.id === my) { ws.removeEventListener('message', onMsg); resolve(m.result); } };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    let data = null;
    for (let i = 0; i < 80 && !data; i++) {
      const r = await call('window.make ? window.make() : null');
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
      data = r.result.value;
      if (!data) await sleep(250);
    }
    fs.writeFileSync(path.join(OUTDIR, `${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
    console.log(`ok ${name}.png (${w}x${h})`);
  } catch (e) {
    console.error(`ERROR ${name}: ${e.message}`);
  } finally {
    try { ws && ws.close(); } catch (_) { /* nada */ }
    chrome.kill();
    await sleep(800);
  }
}
server.close();
