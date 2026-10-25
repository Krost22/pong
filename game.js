(() => {
  'use strict';

  // --- Configuración ---
  // El campo se modela siempre en horizontal: W es el eje entre jugadores y H el eje de las paletas.
  // En vertical solo cambia el dibujo y la lectura táctil (J1 abajo, J2/COM arriba).
  const W = 320, MIN_H = 150, MAX_H = 240;
  const SCALE = 4; // resolución interna: el movimiento es suave aunque los bloques se vean pixelados
  const WIN_SCORE = 11;
  const PADDLE_W = 4, PADDLE_H = 24, PADDLE_SPEED = 260, PADDLE_MARGIN = 12;
  const TOUCH_SPEED = 1400; // la paleta sigue al dedo casi al instante, sin teletransportarse
  const BALL_SIZE = 4, BALL_SPEED = 140, BALL_MAX_SPEED = 330, BALL_ACCEL = 1.05;
  const AI_SPEED = 105, AI_REACTION = 0.14;
  const LEVEL_STEP = 0.10, GOALS_PER_LEVEL = 3; // +10% de dificultad cada 3 goles
  const SERVE_DELAY = 1;
  const MAX_STEP = 1 / 240; // subpasos para que la pelota no atraviese las paletas

  // Dígitos de 3x5 píxeles, estilo marcador clásico
  const DIGITS = [
    '111101101101111', '001001001001001', '111001111100111', '111001111001111',
    '101101111001001', '111100111001111', '111100111101111', '111001001001001',
    '111101111101111', '111101111001111',
  ];

  const $ = (id) => document.getElementById(id);
  const screenEl = $('screen');
  const canvas = $('game');
  const ctx = canvas.getContext('2d');

  // h = alto actual de la paleta; giant/mini/frozen/shield = segundos restantes de cada power-up
  const left = { x: PADDLE_MARGIN, y: 0, score: 0, h: PADDLE_H, giant: 0, mini: 0, frozen: 0, shield: 0 };
  const right = { x: W - PADDLE_MARGIN - PADDLE_W, y: 0, score: 0, h: PADDLE_H, giant: 0, mini: 0, frozen: 0, shield: 0 };
  const ball = { x: 0, y: 0, vx: 0, vy: 0 };
  const ai = { timer: 0, target: 0, error: 0 };
  const keys = new Map(); // tecla pulsada -> orden de pulsación
  const touch = { left: null, right: null };
  const pointers = new Map(); // pointerId -> 'left' | 'right'
  let pressSeq = 0;

  let H = MAX_H;
  let portrait = false;
  let mode = 'com';      // com | 2p
  let style = 'classic'; // classic | modern
  let state = 'menu';    // menu | serve | play | paused | over
  let pausedFrom = 'play';
  let serveTimer = 0, serveDir = 1;
  let level = 0;
  let msgTimer = 0;
  let muted = false;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const difficulty = () => (mode === 'com' ? Math.pow(1 + LEVEL_STEP, level) : 1);
  const modernOn = () => style === 'modern';
  const sfx = () => window.PongAudio[style];

  // --- Pantalla y orientación ---
  function layout() {
    const margin = 6;
    const vw = window.innerWidth - margin * 2, vh = window.innerHeight - margin * 2;
    portrait = vh > vw;
    screenEl.classList.toggle('portrait', portrait);

    // El eje corto del campo se adapta a la proporción de la pantalla para ocuparla entera
    const newH = Math.round(clamp(W * Math.min(vw, vh) / Math.max(vw, vh), MIN_H, MAX_H));
    if (newH !== H) {
      const r = newH / H;
      const rescale = (y, size) => clamp((y + size / 2) * r - size / 2, 0, newH - size);
      left.y = rescale(left.y, left.h);
      right.y = rescale(right.y, right.h);
      ball.y = rescale(ball.y, BALL_SIZE);
      ai.target *= r;
      H = newH;
    }

    const { w: cw, h: ch } = screenSize();
    canvas.width = cw * SCALE;
    canvas.height = ch * SCALE;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    const k = Math.min(vw / cw, vh / ch);
    screenEl.style.width = `${Math.floor(cw * k)}px`;
    screenEl.style.height = `${Math.floor(ch * k)}px`;
  }

  function screenSize() {
    return portrait ? { w: H, h: W } : { w: W, h: H };
  }

  // --- Flujo de juego ---
  function centerBall() {
    ball.x = (W - BALL_SIZE) / 2;
    ball.y = (H - BALL_SIZE) / 2;
    ball.vx = ball.vy = 0;
  }

  function resetField() {
    powerups.reset();
    left.y = right.y = (H - PADDLE_H) / 2;
    ai.target = H / 2;
    centerBall();
  }

  function newGame() {
    left.score = right.score = 0;
    level = 0;
    resetField();
    releaseAll();
    hideMsg();
    modern.reset();
    serveDir = Math.random() < 0.5 ? -1 : 1;
    startServe();
    showScreen('game');
    updateHud();
    sfx().start();
  }

  function startServe() {
    centerBall();
    serveTimer = SERVE_DELAY;
    state = 'serve';
  }

  function launch() {
    const angle = (Math.random() * 2 - 1) * Math.PI / 6;
    const speed = BALL_SPEED * difficulty();
    ball.vx = Math.cos(angle) * speed * serveDir;
    ball.vy = Math.sin(angle) * speed;
    rollAiError();
    state = 'play';
    sfx().serve();
  }

  function goal(scorer) {
    const side = scorer === left ? 'left' : 'right';
    scorer.score++;
    sfx().goal();
    if (modernOn()) {
      modern.onGoal(side, ball.y + BALL_SIZE / 2);
      powerups.onGoal();
    }
    if (scorer.score >= WIN_SCORE) {
      endGame(scorer);
      return;
    }
    if (modernOn()) showMsg('¡GOL!', 1);
    if (mode === 'com') {
      const newLevel = Math.floor((left.score + right.score) / GOALS_PER_LEVEL);
      if (newLevel !== level) {
        level = newLevel;
        showMsg(`NIVEL ${level + 1}`, 1.6);
        sfx().level();
      }
    }
    updateHud();
    // Clásico: saca hacia quien recibió el gol. Moderno: hacia la cancha de quien anotó.
    const towardScorer = scorer === left ? -1 : 1;
    serveDir = modernOn() ? towardScorer : -towardScorer;
    startServe();
  }

  function endGame(winner) {
    state = 'over';
    centerBall();
    hideMsg();
    const name = winner === left ? 'JUGADOR 1' : (mode === 'com' ? 'COM' : 'JUGADOR 2');
    $('winner').textContent = `¡GANA ${name}!`;
    $('final').textContent = `${left.score} - ${right.score}`;
    updateHud();
    showScreen('over');
    sfx().win();
    if (modernOn()) modern.onWin(winner === left ? 'left' : 'right');
  }

  function toMenu() {
    state = 'menu';
    left.score = right.score = 0;
    level = 0;
    resetField();
    releaseAll();
    hideMsg();
    showScreen('menu');
  }

  function pause() {
    if (state !== 'play' && state !== 'serve') return;
    pausedFrom = state;
    state = 'paused';
    releaseAll();
    showScreen('pause');
  }

  function resume() {
    if (state !== 'paused') return;
    state = pausedFrom;
    showScreen('game');
  }

  function togglePause() {
    if (state === 'paused') resume();
    else pause();
  }

  // --- Actualización ---
  function update(dt) {
    if (msgTimer > 0 && (msgTimer -= dt) <= 0) hideMsg();
    if (modernOn() && state !== 'paused') modern.update(dt);
    if (state !== 'serve' && state !== 'play') return;

    movePaddles(dt);
    if (modernOn()) powerups.update(dt);

    if (state === 'serve') {
      if ((serveTimer -= dt) <= 0) launch();
      return;
    }

    let t = dt;
    while (t > 0 && state === 'play') {
      const step = Math.min(t, MAX_STEP);
      stepBall(step);
      t -= step;
    }
  }

  // Si se mantienen arriba y abajo a la vez, manda la última tecla pulsada
  function axis(upCodes, downCodes) {
    const latest = (codes) => Math.max(0, ...codes.map((c) => keys.get(c) || 0));
    const up = latest(upCodes), down = latest(downCodes);
    return up === down ? 0 : (down > up ? 1 : -1);
  }

  function movePaddles(dt) {
    if (mode === 'com') {
      drive(left, axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']), touch.left, dt);
      updateAI(dt);
    } else {
      drive(left, axis(['KeyW'], ['KeyS']), touch.left, dt);
      drive(right, axis(['ArrowUp'], ['ArrowDown']), touch.right, dt);
    }
  }

  function moveToward(p, y, maxStep) {
    p.y = clamp(p.y + clamp(y - p.y, -maxStep, maxStep), 0, H - p.h);
  }

  function drive(p, dir, touchY, dt) {
    if (p.frozen > 0) return;
    if (dir) p.y = clamp(p.y + dir * PADDLE_SPEED * dt, 0, H - p.h);
    else if (touchY !== null) moveToward(p, touchY - p.h / 2, TOUCH_SPEED * dt);
  }

  function rollAiError() {
    ai.error = (Math.random() * 2 - 1) * PADDLE_H * 0.45;
  }

  function updateAI(dt) {
    const f = difficulty();
    if ((ai.timer -= dt) <= 0) {
      ai.timer = AI_REACTION / f;
      // Persigue la bola que llega más cerca; las bolas fantasma pueden engañarla
      const incoming = [ball, ...(modernOn() ? powerups.ghosts : [])].filter((b) => b.vx > 0);
      const chase = incoming.sort((a, b) => b.x - a.x)[0];
      ai.target = chase ? chase.y + BALL_SIZE / 2 + ai.error : H / 2;
    }
    if (right.frozen > 0) return;
    moveToward(right, ai.target - right.h / 2, AI_SPEED * f * dt);
  }

  function overlaps(p) {
    return ball.x < p.x + PADDLE_W && ball.x + BALL_SIZE > p.x &&
           ball.y < p.y + p.h && ball.y + BALL_SIZE > p.y;
  }

  function hit(p, dir) {
    const side = p === left ? 'left' : 'right';
    const rel = clamp((ball.y + BALL_SIZE / 2 - (p.y + p.h / 2)) / (p.h / 2 + BALL_SIZE / 2), -1, 1);
    const angle = rel * Math.PI / 3;
    let speed = Math.min(Math.hypot(ball.vx, ball.vy) * BALL_ACCEL, BALL_MAX_SPEED * difficulty());
    if (modernOn()) speed = powerups.adjustHitSpeed(side, speed);
    ball.vx = Math.cos(angle) * speed * dir;
    ball.vy = Math.sin(angle) * speed;
    ball.x = dir > 0 ? p.x + PADDLE_W : p.x - BALL_SIZE;
    if (dir > 0) rollAiError();
    sfx().hit(clamp((speed - BALL_SPEED) / (BALL_MAX_SPEED - BALL_SPEED), 0, 1));
    if (modernOn()) modern.onHit(side, dir);
  }

  function wallBounce() {
    sfx().wall();
    if (modernOn()) modern.onWall();
  }

  function stepBall(dt) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.y < 0) {
      ball.y = 0;
      ball.vy = Math.abs(ball.vy);
      wallBounce();
    } else if (ball.y > H - BALL_SIZE) {
      ball.y = H - BALL_SIZE;
      ball.vy = -Math.abs(ball.vy);
      wallBounce();
    }

    if (modernOn()) powerups.collide();

    if (ball.vx < 0 && overlaps(left)) hit(left, 1);
    else if (ball.vx > 0 && overlaps(right)) hit(right, -1);

    if (modernOn()) powerups.checkShield();
    if (ball.x + BALL_SIZE < 0) goal(right);
    else if (ball.x > W) goal(left);
  }

  // --- Dibujo ---
  const snap = (v) => Math.round(v * SCALE) / SCALE;

  // Rectángulo en coordenadas del campo; en vertical se gira para que J1 quede abajo
  function rect(x, y, w, h) {
    x = snap(x);
    y = snap(y);
    if (portrait) ctx.fillRect(y, W - x - w, h, w);
    else ctx.fillRect(x, y, w, h);
  }

  function numberWidth(n, s) {
    return String(n).length * 4 * s - s;
  }

  // Los números se dibujan en coordenadas de pantalla para que nunca salgan girados
  function drawNumber(n, x, y, s) {
    for (const ch of String(n)) {
      const bits = DIGITS[+ch];
      for (let i = 0; i < 15; i++) {
        if (bits[i] === '1') ctx.fillRect(x + (i % 3) * s, y + Math.floor(i / 3) * s, s, s);
      }
      x += 4 * s;
    }
  }

  // Posición (en pantalla) de cada marcador; la usan el dibujo y el confeti
  function scoreBoxes() {
    const s = 4;
    if (portrait) {
      return { left: { x: 14, y: W / 2 + 16, s }, right: { x: 14, y: W / 2 - 16 - 5 * s, s } };
    }
    return { left: { x: W / 2 - 24 - numberWidth(left.score, s), y: 12, s }, right: { x: W / 2 + 24, y: 12, s } };
  }

  function ballVisible() {
    const blinking = state === 'serve' && Math.floor(serveTimer * 6) % 2 === 1;
    return state !== 'over' && state !== 'menu' && !blinking;
  }

  function drawClassic() {
    const { w: cw, h: ch } = screenSize();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#fff';

    for (let y = 3; y < H; y += 12) rect(W / 2 - 1, y, 2, 6);

    const boxes = scoreBoxes();
    drawNumber(left.score, boxes.left.x, boxes.left.y, boxes.left.s);
    drawNumber(right.score, boxes.right.x, boxes.right.y, boxes.right.s);

    rect(left.x, left.y, PADDLE_W, left.h);
    rect(right.x, right.y, PADDLE_W, right.h);

    if (ballVisible()) rect(ball.x, ball.y, BALL_SIZE, BALL_SIZE);
  }

  // Rectángulo del campo convertido a coordenadas de pantalla (para sprites que no deben girar)
  function toScreenRect(x, y, w, h) {
    return portrait ? { x: y, y: W - x - w, w: h, h: w } : { x, y, w, h };
  }

  const playerName = (side) => (side === 'left' ? 'J1' : (mode === 'com' ? 'COM' : 'J2'));

  function draw() {
    if (modernOn()) modern.draw();
    else drawClassic();
  }

  const powerups = window.PongPowerups({
    ctx, W, BALL_SIZE, PADDLE_H, BALL_SPEED, left, right, ball,
    get H() { return H; },
    get state() { return state; },
    fx: () => modern,
    rect, toScreenRect, playerName, showMsg,
  });

  const modern = window.PongModern({
    ctx, W, PADDLE_W, BALL_SIZE, BALL_MAX_SPEED, left, right, ball, powerups,
    get H() { return H; },
    get state() { return state; },
    rect, drawNumber, numberWidth, scoreBoxes, screenSize, ballVisible,
  });

  // --- Interfaz ---
  function showScreen(name) {
    for (const id of ['menu', 'pause', 'over']) $(id).classList.toggle('hidden', name !== id);
    $('hud').classList.toggle('hidden', name === 'menu');
    $('btn-pause').classList.toggle('hidden', name !== 'game');
    $('quit-msg').classList.add('hidden');
    screenEl.classList.toggle('modern', modernOn() && name !== 'menu');
  }

  function updateHud() {
    $('hud').textContent = mode === 'com'
      ? `COM · NIVEL ${level + 1} · ${Math.round(difficulty() * 100)}%`
      : `2 JUGADORES · A ${WIN_SCORE}`;
  }

  function showMsg(text, seconds) {
    const el = $('msg');
    el.textContent = text;
    el.classList.remove('hidden');
    msgTimer = seconds;
  }

  function hideMsg() {
    $('msg').classList.add('hidden');
    msgTimer = 0;
  }

  // Botones de opción del menú (modo de juego y estilo visual)
  function select(group, value) {
    if (group === 'mode') mode = value;
    else style = value;
    document.querySelectorAll(`[data-${group}]`).forEach((b) => b.classList.toggle('selected', b.dataset[group] === value));
  }

  function quit() {
    // Dentro de la APK, Android expone AndroidApp.exit(); en el navegador solo se puede intentar cerrar
    if (window.AndroidApp) {
      window.AndroidApp.exit();
      return;
    }
    window.close();
    setTimeout(() => $('quit-msg').classList.remove('hidden'), 150);
  }

  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => select('mode', b.dataset.mode)));
  document.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', () => select('style', b.dataset.style)));
  $('btn-start').addEventListener('click', newGame);
  $('btn-quit').addEventListener('click', quit);
  $('btn-pause').addEventListener('click', pause);
  $('btn-resume').addEventListener('click', resume);
  $('btn-new').addEventListener('click', newGame);
  $('btn-exit').addEventListener('click', toMenu);
  $('btn-again').addEventListener('click', newGame);
  $('btn-over-exit').addEventListener('click', toMenu);
  // Quitar el foco tras un clic para que Espacio/Enter no vuelvan a pulsar el botón
  document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => b.blur()));

  // Botón "atrás" de Android: devuelve true si el juego lo gestionó
  window.onAndroidBack = () => {
    if (state === 'play' || state === 'serve') pause();
    else if (state === 'paused') resume();
    else if (state === 'over') toMenu();
    else return false;
    return true;
  };

  // --- Entrada: teclado ---
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    if (!keys.has(e.code)) keys.set(e.code, ++pressSeq);
    if (e.repeat) return;

    if (e.code === 'KeyM') {
      muted = !muted;
      window.PongAudio.setMuted(muted);
      return;
    }
    if (state === 'menu') {
      if (e.code === 'Digit1' || e.code === 'Numpad1') select('mode', 'com');
      else if (e.code === 'Digit2' || e.code === 'Numpad2') select('mode', '2p');
      else if (e.code === 'KeyC') select('style', 'classic');
      else if (e.code === 'KeyX') select('style', 'modern');
      else if (e.code === 'Enter') newGame();
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape' || e.code === 'Space') togglePause();
    else if (e.code === 'KeyN' || (state === 'over' && e.code === 'Enter')) newGame();
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    // Con Cmd/Ctrl pulsado algunos navegadores no envían el keyup de las demás teclas
    if (e.key === 'Meta' || e.key === 'Control') keys.clear();
  });

  function releaseAll() {
    keys.clear();
    pointers.clear();
    touch.left = touch.right = null;
  }

  window.addEventListener('blur', () => {
    releaseAll();
    pause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      releaseAll();
      pause();
    }
  });

  // --- Entrada: táctil / ratón ---
  // Horizontal: mitad izquierda = J1, mitad derecha = J2. Vertical: mitad inferior = J1, superior = J2.
  // Contra la COM, toda la pantalla controla a J1. La paleta sigue la posición del dedo.
  function readPointer(e) {
    const r = canvas.getBoundingClientRect();
    return portrait
      ? { side: e.clientY > r.top + r.height / 2 ? 'left' : 'right', pos: (e.clientX - r.left) / r.width * H }
      : { side: e.clientX < r.left + r.width / 2 ? 'left' : 'right', pos: (e.clientY - r.top) / r.height * H };
  }

  function onPointerDown(e) {
    if (state !== 'play' && state !== 'serve') return;
    if (e.target.closest && e.target.closest('button')) return;
    const p = readPointer(e);
    const side = mode === '2p' ? p.side : 'left';
    pointers.set(e.pointerId, side);
    touch[side] = p.pos;
    e.preventDefault();
  }

  function onPointerMove(e) {
    const side = pointers.get(e.pointerId);
    if (side) touch[side] = readPointer(e).pos;
  }

  function onPointerEnd(e) {
    const side = pointers.get(e.pointerId);
    if (!side) return;
    pointers.delete(e.pointerId);
    // Si otro dedo sigue en esa mitad, la paleta lo sigue a él
    if (![...pointers.values()].includes(side)) touch[side] = null;
  }

  window.addEventListener('pointerdown', onPointerDown, { passive: false });
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerEnd);
  window.addEventListener('pointercancel', onPointerEnd);
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);

  // --- Bucle principal ---
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  layout();
  resetField();
  requestAnimationFrame(frame);
})();
