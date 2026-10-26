// Graba el tráiler: sirve el juego, controla Chrome por CDP, guarda cada fotograma,
// sintetiza la música chiptune y monta el MP4 con ffmpeg.
// Uso: node record.mjs <carpeta del juego> <carpeta de trabajo> <mp4 de salida> [página] [ancho] [alto]
// (por defecto trailer.html, que sale a 1920x1080; para TikTok: tiktok.html 1080 1920)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { writeMusic } from './music.mjs'; // música chiptune sintetizada

const [GAME, DIR, OUTPUT, PAGE = 'trailer.html', VW = '1280', VH = '720'] = process.argv.slice(2);
const FRAMES = path.join(DIR, 'frames');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FPS = 30;
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

// En el juego servido: requestAnimationFrame manual, sin pausas por perder el foco y azar con semilla fija
// (mismos power-ups en cada grabación: si una toma sale bien, sale igual siempre)
const STUB = '<head><script>window.__raf=null;window.requestAnimationFrame=(cb)=>{window.__raf=cb};' +
  '(()=>{let s=20261025;Math.random=()=>{s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);' +
  't=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};})();' +
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
  // Avisa si la imagen se queda congelada (fotogramas idénticos seguidos): en un vídeo se ve como un tirón
  let prev = null, runStart = 0;
  const frozen = [];
  for (let i = 0; i <= total; i++) {
    const data = i < total ? await evaluate(`renderFrame(${i})`) : null;
    if (data !== prev) {
      if (i - runStart >= 8) frozen.push(`${(runStart / FPS).toFixed(2)}-${(i / FPS).toFixed(2)} s`);
      runStart = i;
      prev = data;
    }
    if (i === total) break;
    fs.writeFileSync(path.join(FRAMES, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
    if (i % 100 === 0) console.log(`  ${i}/${total}`);
  }
  if (frozen.length) console.warn(`AVISO: imagen congelada en ${frozen.join(', ')}`);
  const wav = path.join(DIR, 'music.wav');
  writeMusic(total / FPS, wav);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  // Sonoridad estándar de plataformas (YouTube/TikTok normalizan a unos -14 LUFS) con pico real de -1 dBTP para que
  // el AAC no sature: primera pasada para medir, segunda lineal con esas medidas
  const LOUD = 'I=-14:TP=-1:LRA=11';
  const probe = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', wav, '-af', `loudnorm=${LOUD}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = JSON.parse(probe.stderr.match(/\{[^{}]*\}/g).pop());
  const loudnorm = `loudnorm=${LOUD}:linear=true:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`;
  // Vídeo en rango limitado BT.709 (los JPEG son de rango completo y algunos reproductores los verían lavados)
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, 'f%04d.jpg'), '-i', wav,
    '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-color_range', 'tv',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-r', String(FPS),
    '-af', `${loudnorm},aresample=48000`, '-c:a', 'aac', '-b:a', '192k', '-shortest',
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
