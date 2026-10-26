// Graba el tráiler: sirve el juego, controla Chrome por CDP, guarda cada fotograma,
// sintetiza la música chiptune y monta el MP4 con ffmpeg.
// Uso: node record.mjs <carpeta del juego> <carpeta de trabajo> <mp4 de salida> [página] [ancho] [alto]
// (por defecto trailer.html a 1280x720; para TikTok: tiktok.html 1080 1920)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const [GAME, DIR, OUTPUT, PAGE = 'trailer.html', VW = '1280', VH = '720'] = process.argv.slice(2);
const FRAMES = path.join(DIR, 'frames');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FPS = 30;
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

// En el juego servido: requestAnimationFrame manual y sin pausas por perder el foco
const STUB = '<head><script>window.__raf=null;window.requestAnimationFrame=(cb)=>{window.__raf=cb};' +
  'try{localStorage.clear()}catch(e){};' +
  'window.addEventListener("blur",(e)=>e.stopImmediatePropagation(),true);' +
  'document.addEventListener("visibilitychange",(e)=>e.stopImmediatePropagation(),true);</script>';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = url.startsWith('/game/') ? path.join(GAME, url.slice(6)) : path.join(DIR, url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(file);
  if (url === '/game/index.html') body = Buffer.from(body.toString('utf8').replace('<head>', STUB));
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
}).listen(8765);

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9333',
  `--user-data-dir=${path.join(DIR, 'profile')}`, `--window-size=${VW},${VH}`, `http://127.0.0.1:8765/${PAGE}`]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, msgId = 0;
const pending = new Map();
function cdp(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
}

// --- Música: chiptune sintetizado (arpegio, bajo, batería) ---
function writeMusic(seconds, file) {
  const sr = 44100, n = Math.ceil(seconds * sr), buf = new Float32Array(n);
  const bpm = 128, step16 = 60 / bpm / 4;
  const prog = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Lam Fa Do Sol
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  const sq = (f, t) => (Math.sin(2 * Math.PI * f * t) >= 0 ? 1 : -1);
  const add = (t0, dur, fn) => {
    const s0 = Math.floor(t0 * sr), s1 = Math.min(n, Math.floor((t0 + dur) * sr));
    for (let i = s0; i < s1; i++) buf[i] += fn((i - s0) / sr);
  };
  const intro = 2.5, outro = seconds - 4.2;
  for (let k = 0; k < Math.floor(seconds / step16); k++) {
    const t = k * step16, chord = prog[Math.floor(k / 16) % 4];
    if (t >= outro) break;
    const note = chord[k % 3] + 12 + (k % 6 >= 3 ? 12 : 0);
    add(t, step16 * 0.9, (lt) => 0.05 * sq(hz(note), lt) * Math.exp(-lt * 8));
    if (t < intro) continue;
    if (k % 2 === 0) add(t, step16 * 1.8, (lt) => 0.08 * sq(hz(chord[0] - 12), lt) * Math.min(1, (step16 * 1.8 - lt) * 40));
    if (k % 8 === 0) add(t, 0.22, (lt) => 0.55 * Math.sin(2 * Math.PI * (45 + 110 * Math.exp(-lt * 25)) * lt) * Math.exp(-lt * 11));
    if (k % 8 === 4) add(t, 0.16, (lt) => 0.2 * (Math.random() * 2 - 1) * Math.exp(-lt * 18));
    if (k % 2 === 1) add(t, 0.04, (lt) => 0.05 * (Math.random() * 2 - 1) * Math.exp(-lt * 80));
  }
  for (const m of prog[0]) add(outro, 4.2, (lt) => 0.06 * sq(hz(m + 12), lt) * Math.exp(-lt * 0.9));
  add(outro, 1.2, (lt) => 0.5 * Math.sin(2 * Math.PI * (40 + 80 * Math.exp(-lt * 10)) * lt) * Math.exp(-lt * 3));
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + n * 2, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12);
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(sr, 24);
  pcm.writeUInt32LE(sr * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / (0.3 * sr), (n - i) / (1.0 * sr));
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i] / peak * 0.9 * fade)) * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, pcm);
}

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
      target = list.find((t) => t.type === 'page' && t.url.includes(PAGE));
    } catch (_) { /* Chrome aún arrancando */ }
  }
  if (!target) throw new Error('Chrome no respondió');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
    }
  });
  let total = null;
  for (let i = 0; i < 80 && !total; i++) {
    total = await evaluate('window.init ? window.init() : null');
    if (!total) await sleep(250);
  }
  if (!total) throw new Error('el juego no arrancó en el iframe: ' + await evaluate('(() => { const w = document.getElementById("g").contentWindow; return JSON.stringify({ url: w && w.location.href, pong: !!(w && w.__pong), raf: !!(w && w.__raf) }); })()'));
  console.log(`fotogramas: ${total} (${(total / FPS).toFixed(1)} s)`);
  for (let i = 0; i < total; i++) {
    const data = await evaluate(`renderFrame(${i})`);
    fs.writeFileSync(path.join(FRAMES, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
    if (i % 100 === 0) console.log(`  ${i}/${total}`);
  }
  const wav = path.join(DIR, 'music.wav');
  writeMusic(total / FPS, wav);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, 'f%04d.jpg'), '-i', wav,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest',
    '-movflags', '+faststart', OUTPUT], { stdio: 'inherit' });
  console.log(r.status === 0 ? `video listo: ${OUTPUT}` : `ffmpeg falló (${r.status})`);
} catch (e) {
  console.error('ERROR', e.message);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch (_) { /* nada */ }
  chrome.kill();
  server.close();
}
