// Reproduce cómo itch.io incrusta el juego: iframe de OTRO origen dentro de una página con scroll,
// en un móvil emulado con pantalla táctil. Toca INICIO y arrastra el dedo para mover la paleta.
// Uso: node tools/test/itch-touch.mjs <carpeta del juego>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const GAME = process.argv[2];
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const gameServer = http.createServer((req, res) => {
  const file = path.join(GAME, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(8771);
const hostServer = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body style="margin:0;background:#222;min-height:2400px">
    <div style="height:60px;color:#fff;font:16px sans-serif;padding:8px">itch.io (simulado)</div>
    <iframe id="game" src="http://127.0.0.1:8771/index.html?debug" allowfullscreen style="width:100%;height:700px;border:0"></iframe>
    </body></html>`);
}).listen(8772);

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9335',
  `--user-data-dir=${path.join(process.env.TEMP, 'pong-itch-touch')}`, '--window-size=412,900', 'about:blank']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map();
const contexts = [];
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const my = ++id;
  pending.set(my, { resolve, reject });
  ws.send(JSON.stringify({ id: my, method, params }));
});

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch('http://127.0.0.1:9335/json/list')).json()).find((t) => t.type === 'page'); } catch (_) { /* arrancando */ }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.executionContextCreated') contexts.push(m.params.context);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 412, height: 900, deviceScaleFactor: 2.6, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: 'http://127.0.0.1:8772/' });
  await sleep(2500);
  // El juego va en un proceso aparte (otro origen): se evalúa en su contexto de ejecución
  const gameCtx = contexts.filter((c) => c.origin === 'http://127.0.0.1:8771').pop();
  const inGame = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, contextId: gameCtx.id, returnByValue: true })).result.value;
  const IFRAME_Y = 60;
  const touch = async (type, x, y) => cdp('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const tap = async (x, y) => { await touch('touchStart', x, y); await sleep(60); await touch('touchEnd', x, y); };

  const btn = JSON.parse(await inGame('JSON.stringify(document.getElementById("btn-start").getBoundingClientRect())'));
  await tap(btn.x + btn.width / 2, btn.y + btn.height / 2 + IFRAME_Y);
  await sleep(800);
  const before = await inGame('JSON.stringify({ state: window.__pong.state, menu: !document.getElementById("menu").classList.contains("hidden"), y: window.__pong.left.y })');
  console.log('tras tocar INICIO:', before);
  // Arrastra en la mitad inferior (J1 en vertical) de izquierda a derecha
  const c = JSON.parse(await inGame('JSON.stringify(document.getElementById("game").getBoundingClientRect())'));
  const yTouch = c.y + c.height * 0.8 + IFRAME_Y;
  const samples = [];
  await touch('touchStart', c.x + 20, yTouch);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', c.x + 20 + (c.width - 40) * i / 12, yTouch);
    await sleep(60);
    samples.push(Math.round(await inGame('window.__pong.left.y')));
  }
  await touch('touchEnd', 0, 0);
  console.log('posición de la paleta J1 durante el arrastre:', samples.join(' → '));
  console.log('scroll de la página padre:', (await cdp('Runtime.evaluate', { expression: 'window.scrollY', returnByValue: true })).result.value);
} catch (e) {
  console.error('ERROR', e.message);
} finally {
  try { ws && ws.close(); } catch (_) { /* nada */ }
  chrome.kill();
  gameServer.close();
  hostServer.close();
}
