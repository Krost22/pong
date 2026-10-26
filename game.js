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
  const BOARD_SIZE = 5;
  const BOARD_KEYS = { krostnoid: 'pong.krostnoid.board', roguelike: 'pong.roguelike.board' };
  const ROGUE_SHIELD = 15; // segundos de escudo con la carta "Escudo de inicio"

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

  // h = alto actual de la paleta; giant/mini/frozen/shield = segundos restantes de cada power-up;
  // boost = ayuda por ir perdiendo de 5 (paleta +50% hasta empatar); sizeMult = tamaño base (RogueLike)
  const paddle = (x) => ({ x, y: 0, score: 0, h: PADDLE_H, giant: 0, mini: 0, frozen: 0, shield: 0, boost: false, sizeMult: 1 });
  const left = paddle(PADDLE_MARGIN);
  const right = paddle(W - PADDLE_MARGIN - PADDLE_W);
  const ball = { x: 0, y: 0, vx: 0, vy: 0 };
  const ai = { left: { timer: 0, target: 0, error: 0 }, right: { timer: 0, target: 0, error: 0 } };
  const keys = new Map(); // tecla pulsada -> orden de pulsación
  const touch = { left: null, right: null, knoid: null };
  const pointers = new Map(); // pointerId -> 'left' | 'right' | 'knoid'
  let pressSeq = 0;

  let H = MAX_H;
  let portrait = false;
  let game = 'pong';     // pong | krostnoid | roguelike
  let mode = 'com';      // com | 2p (solo Pong)
  let style = 'classic'; // classic | modern (solo Pong)
  let state = 'serve';   // serve | play | paused | over | between (RogueLike: mapa, cartas, tienda...)
  let demo = true;       // partida automática de fondo mientras se ve el menú
  let pausedFrom = 'play';
  let serveTimer = 0, serveDir = 1;
  let level = 0;
  let msgTimer = 0;
  let muted = false;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const isKnoid = () => game === 'krostnoid';
  const isRogue = () => game === 'roguelike';
  const inRun = () => isRogue() && !demo; // partida real de RogueLike (no la demo del menú)
  const vsCom = () => isRogue() || mode === 'com';
  function difficulty() {
    if (demo) return 1;
    if (isRogue()) return rogue.difficulty();
    return vsCom() ? Math.pow(1 + LEVEL_STEP, level) : 1;
  }
  // El RogueLike usa el motor del Pong moderno
  const modernOn = () => isRogue() || style === 'modern';
  const sideOf = (p) => (p === left ? 'left' : 'right');
  // La demo del menú juega sin sonido
  const SILENT = new Proxy({}, { get: () => () => {} });
  const sfx = () => (demo ? SILENT : window.PongAudio[game === 'pong' ? style : 'modern']);

  // --- Récords (se guardan en el dispositivo) ---
  function loadBoard(key) {
    try {
      const board = JSON.parse(localStorage.getItem(key));
      return Array.isArray(board) ? board : [];
    } catch (_) {
      return [];
    }
  }

  const bestScore = (key) => (loadBoard(key)[0] || { score: 0 }).score;

  // detail = texto extra para la tabla (p. ej. "PISO 3" en el RogueLike)
  function saveScore(key, score, detail = '') {
    const board = loadBoard(key);
    const best = board.length ? board[0].score : 0;
    const entry = { score, detail, date: new Date().toLocaleDateString('es', { day: '2-digit', month: '2-digit' }), id: Date.now() };
    if (score > 0) { // las partidas sin puntos no entran en la tabla
      board.push(entry);
      board.sort((a, b) => b.score - a.score);
      board.splice(BOARD_SIZE);
      try { localStorage.setItem(key, JSON.stringify(board)); } catch (_) { /* sin almacenamiento */ }
    }
    return { board, entry, best: Math.max(best, score), isRecord: score > best && score > 0 };
  }

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
      ai.left.target *= r;
      ai.right.target *= r;
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
    ai.left.target = ai.right.target = H / 2;
    centerBall();
  }

  function resetMatch() {
    left.score = right.score = 0;
    left.sizeMult = right.sizeMult = 1;
    level = 0;
    resetField();
    releaseAll();
    hideMsg();
    modern.reset();
    if (isRogue()) modern.setTheme('lava', true); // la demo del RogueLike se juega en el volcán
    if (isKnoid()) {
      knoid.start(demo);
      state = 'play';
      return;
    }
    serveDir = Math.random() < 0.5 ? -1 : 1;
    startServe();
  }

  function newGame() {
    demo = false;
    if (isRogue()) {
      rogue.startRun(); // empieza en el mapa del piso 1
      return;
    }
    resetMatch();
    showScreen('game');
    updateHud();
    sfx().start();
  }

  function continueRun() {
    demo = false;
    rogue.continueRun();
  }

  // --- RogueLike: lo llama roguelike.js ---
  // Deja la cancha limpia (con el tema del piso) para mostrar las pantallas entre salas
  function prepareRogue(theme) {
    demo = false;
    left.score = right.score = 0;
    left.sizeMult = right.sizeMult = 1;
    resetField();
    releaseAll();
    hideMsg();
    modern.reset();
    modern.setTheme(theme, true);
    state = 'between';
  }

  function beginRogueRoom({ theme, playerSize, enemySize, shield }) {
    left.score = right.score = 0;
    left.sizeMult = playerSize;
    right.sizeMult = enemySize;
    resetField();
    releaseAll();
    hideMsg();
    modern.reset();
    modern.setTheme(theme, true);
    if (shield) left.shield = ROGUE_SHIELD;
    serveDir = 1;
    startServe();
    showScreen('game');
    updateHud();
  }

  function endRogueRun({ title, points, detail, victory }) {
    state = 'over';
    centerBall();
    hideMsg();
    const result = saveScore(BOARD_KEYS.roguelike, points, detail);
    showResults({ title, final: `${points} PUNTOS · ${detail}`, result });
    if (victory || result.isRecord) {
      modern.celebrate('left');
      sfx().record();
    } else {
      sfx().gameOver();
    }
  }

  function toMenu() {
    demo = true;
    resetMatch();
    showScreen('menu');
    updateMenu();
  }

  function startServe() {
    centerBall();
    serveTimer = SERVE_DELAY;
    state = 'serve';
  }

  function launch() {
    const angle = (Math.random() * 2 - 1) * Math.PI / 6;
    const speed = BALL_SPEED * difficulty() * (inRun() ? rogue.serveMult(serveDir) : 1);
    ball.vx = Math.cos(angle) * speed * serveDir;
    ball.vy = Math.sin(angle) * speed;
    rollAiError('left');
    rollAiError('right');
    state = 'play';
    sfx().serve();
  }

  function goal(scorer) {
    const side = sideOf(scorer);
    scorer.score++;
    sfx().goal();
    let fiery = false;
    if (modernOn()) {
      fiery = modern.onGoal(side, ball.y + BALL_SIZE / 2);
      powerups.onGoal();
    }
    if (inRun()) {
      rogueGoal(side, fiery);
      return;
    }
    if (scorer.score >= WIN_SCORE) {
      if (demo) {
        left.score = right.score = 0; // la demo vuelve a empezar sin pantalla final
      } else {
        endGame(scorer);
        return;
      }
    }
    if (modernOn()) {
      showMsg('¡GOL!', 0.8);
      powerups.checkComeback();
    }
    if (vsCom() && !demo) {
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

  // RogueLike: la run decide si se sigue jugando, si la sala está superada o si se acabó
  function rogueGoal(side, fiery) {
    const result = rogue.onGoal(side, fiery);
    if (result === 'runOver') return; // roguelike.js ya mostró los resultados
    updateHud();
    if (result === 'roomCleared') {
      state = 'between';
      centerBall();
      releaseAll();
      $('btn-pause').classList.add('hidden');
      return;
    }
    serveDir = side === 'left' ? -1 : 1; // como en el moderno: hacia la cancha de quien anotó
    startServe();
  }

  function endGame(winner) {
    state = 'over';
    centerBall();
    hideMsg();
    showResults({
      title: `¡GANA ${winner === left ? 'JUGADOR 1' : (vsCom() ? 'COM' : 'JUGADOR 2')}!`,
      final: `${left.score} - ${right.score}`,
    });
    sfx().win();
    if (modernOn()) modern.onWin(sideOf(winner));
  }


  function knoidOver(score, reached) {
    state = 'over';
    hideMsg();
    const result = saveScore(BOARD_KEYS.krostnoid, score);
    showResults({ title: 'PERDISTE', final: `${score} PUNTOS · NIVEL ${reached}`, result });
    sfx()[result.isRecord ? 'record' : 'gameOver']();
  }

  function pause() {
    if (demo || (state !== 'play' && state !== 'serve')) return;
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
    if (msgTimer > 0 && (msgTimer -= dt) <= 0) nextMsg();
    if (isKnoid()) {
      if (state === 'play') knoid.update(dt);
      return;
    }
    if (modernOn() && state !== 'paused') modern.update(dt);
    if (inRun() && state !== 'paused') rogue.update(dt); // rasgos del rival y pantallas con retardo
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

  // Si se mantienen las dos direcciones a la vez, manda la última tecla pulsada
  function axis(negCodes, posCodes) {
    const latest = (codes) => Math.max(0, ...codes.map((c) => keys.get(c) || 0));
    const neg = latest(negCodes), pos = latest(posCodes);
    return neg === pos ? 0 : (pos > neg ? 1 : -1);
  }

  function movePaddles(dt) {
    if (demo) {
      updateAI(left, dt);
      updateAI(right, dt);
    } else if (vsCom()) {
      drive(left, axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']) || padAxis(0), touch.left, dt);
      updateAI(right, dt);
    } else {
      drive(left, axis(['KeyW'], ['KeyS']) || padAxis(0), touch.left, dt);
      drive(right, axis(['ArrowUp'], ['ArrowDown']) || padAxis(1), touch.right, dt);
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

  // Rasgos del rival del RogueLike (velocidad, reacción y puntería de la COM)
  const rivalAI = (side) => (side === 'right' && inRun() && rogue.ai) || { speed: 1, reaction: 1, error: 1 };

  function rollAiError(side) {
    ai[side].error = (Math.random() * 2 - 1) * PADDLE_H * 0.45 * rivalAI(side).error;
  }

  function updateAI(p, dt) {
    const side = sideOf(p);
    const s = ai[side];
    const mods = rivalAI(side);
    const toward = side === 'right' ? 1 : -1;
    const f = difficulty();
    if ((s.timer -= dt) <= 0) {
      s.timer = AI_REACTION / f * mods.reaction;
      // Persigue la bola que llega más cerca; las bolas fantasma pueden engañarla
      const incoming = [ball, ...(modernOn() ? powerups.ghosts : [])].filter((b) => b.vx * toward > 0);
      const chase = incoming.sort((a, b) => (b.x - a.x) * toward)[0];
      s.target = chase ? chase.y + BALL_SIZE / 2 + s.error : H / 2;
    }
    if (p.frozen > 0) return;
    moveToward(p, s.target - p.h / 2, AI_SPEED * f * mods.speed * dt);
  }

  function overlaps(p) {
    return ball.x < p.x + PADDLE_W && ball.x + BALL_SIZE > p.x &&
           ball.y < p.y + p.h && ball.y + BALL_SIZE > p.y;
  }

  function hit(p, dir) {
    const side = sideOf(p);
    const rel = clamp((ball.y + BALL_SIZE / 2 - (p.y + p.h / 2)) / (p.h / 2 + BALL_SIZE / 2), -1, 1);
    let angle = rel * Math.PI / 3;
    const maxSpeed = BALL_MAX_SPEED * difficulty();
    let speed = Math.min(Math.hypot(ball.vx, ball.vy) * BALL_ACCEL, maxSpeed);
    if (modernOn()) speed = powerups.adjustHitSpeed(side, speed);
    if (inRun()) {
      angle = rogue.adjustAngle(side, angle);
      speed = rogue.adjustHitSpeed(side, speed, maxSpeed);
    }
    ball.vx = Math.cos(angle) * speed * dir;
    ball.vy = Math.sin(angle) * speed;
    ball.x = dir > 0 ? p.x + PADDLE_W : p.x - BALL_SIZE;
    rollAiError(dir > 0 ? 'right' : 'left');
    sfx().hit(clamp((speed - BALL_SPEED) / (BALL_MAX_SPEED - BALL_SPEED), 0, 1));
    if (modernOn()) modern.onHit(side, dir);
    if (inRun() && side === 'left') rogue.onPlayerHit();
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

  // Rectángulo del campo convertido a coordenadas de pantalla (para sprites que no deben girar)
  function toScreenRect(x, y, w, h) {
    return portrait ? { x: y, y: W - x - w, w: h, h: w } : { x, y, w, h };
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

  // Posición (en pantalla) de cada marcador; la usan el dibujo y el confeti.
  // En Supervivencia hay un único marcador (J1) y el reloj; en el RogueLike, J1 con corazones,
  // los goles que faltan para superar la sala y la barra del jefe.
  function scoreBoxes() {
    const s = 4;
    if (inRun()) {
      const pipsW = Math.max(0, rogue.hudInfo().target * 6 - 2);
      // En vertical todo va junto al marcador, a un lado de la línea central: así nada tapa
      // las zonas de las paletas (la del rival está arriba del todo y la tuya abajo)
      if (portrait) {
        return {
          left: { x: 14, y: W / 2 - 6 - 5 * s, s }, right: null,
          boss: { x: 14, y: W / 2 - 6 - 5 * s - 10, w: Math.min(70, H - 28) },
          pips: { x: 14, y: W / 2 + 6 }, hearts: { x: 14, y: W / 2 + 15 },
        };
      }
      return {
        left: { x: W / 2 - numberWidth(left.score, s) / 2, y: 10, s }, right: null,
        pips: { x: W / 2 - pipsW / 2, y: 34 }, hearts: { x: 22, y: H - 10 }, boss: { x: W / 2 + 28, y: 12, w: W / 2 - 56 },
      };
    }
    if (portrait) {
      return { left: { x: 14, y: W / 2 + 16, s }, right: { x: 14, y: W / 2 - 16 - 5 * s, s } };
    }
    return { left: { x: W / 2 - 24 - numberWidth(left.score, s), y: 12, s }, right: { x: W / 2 + 24, y: 12, s } };
  }

  function ballVisible() {
    const blinking = state === 'serve' && Math.floor(serveTimer * 6) % 2 === 1;
    return state !== 'over' && !blinking;
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

  function draw() {
    if (isKnoid()) knoid.draw();
    else if (modernOn()) modern.draw();
    else drawClassic();
  }

  const playerName = (side) => (side === 'left' ? 'J1' : (vsCom() ? 'COM' : 'J2'));

  const powerups = window.PongPowerups({
    ctx, W, BALL_SIZE, PADDLE_H, BALL_SPEED, left, right, ball,
    get H() { return H; },
    get state() { return state; },
    fx: () => modern,
    sfx: () => sfx(),
    giftRate: () => (inRun() ? rogue.giftRate() : 1),
    rect, toScreenRect, playerName, showMsg,
  });

  const modern = window.PongModern({
    ctx, W, PADDLE_W, BALL_SIZE, BALL_MAX_SPEED, left, right, ball, powerups,
    get H() { return H; },
    get state() { return state; },
    get rogue() { return inRun() ? rogue.hudInfo() : null; },
    fireSpeed: () => (inRun() ? rogue.fireSpeed() : null),
    sfx: () => sfx(),
    rect, toScreenRect, drawNumber, numberWidth, scoreBoxes, screenSize, ballVisible,
  });

  const knoid = window.PongKrostnoid({
    ctx, screenSize, snap, axis, showMsg,
    padX: () => pads[0].x, // palanca o cruceta del mando de J1
    sfx: () => sfx(),
    touchX: () => touch.knoid,
    record: () => bestScore(BOARD_KEYS.krostnoid),
    setHud: setHudText,
    onGameOver: knoidOver,
  });

  const rogue = window.PongRoguelike({
    ball, left, right, powerups,
    get state() { return state; },
    fx: () => modern,
    sfx: () => sfx(),
    showMsg, toMenu,
    setHud: renderRogueHud,
    prepare: prepareRogue,
    beginRoom: beginRogueRoom,
    endRun: endRogueRun,
    setTheme: (theme) => modern.setTheme(theme),
    showRogue: () => showScreen('rogue'),
  });

  // --- Interfaz ---
  function showScreen(name) {
    for (const id of ['menu', 'pause', 'over', 'rogue']) $(id).classList.toggle('hidden', name !== id);
    if (name === 'rogue') hideMsg(); // que ningún aviso de la sala se vea detrás de las cartas
    $('hud').classList.toggle('hidden', name === 'menu');
    $('btn-pause').classList.toggle('hidden', name !== 'game');
    // En una run, "juego nuevo" desde la pausa borraría la run guardada: solo se puede salir
    $('btn-new').classList.toggle('hidden', isRogue());
    $('quit-msg').classList.add('hidden');
    screenEl.classList.toggle('modern', game !== 'pong' || style === 'modern');
    screenEl.classList.toggle('knoid', isKnoid());
    screenEl.classList.toggle('rogue', isRogue());
    // Jugando con mando, al abrirse un menú el foco va al primer botón
    clearPadFocus();
    if (padInUse && name !== 'game') {
      const first = overlayButtons()[0];
      if (first) focusButton(first);
    }
  }

  // Pantalla final: título, puntos y, en los modos con récord, la tabla de mejores puntuaciones
  function showResults({ title, final, result }) {
    $('winner').textContent = title;
    $('final').textContent = final;
    const recordLine = $('record-line'), board = $('board');
    recordLine.classList.toggle('hidden', !result);
    board.classList.toggle('hidden', !result);
    $('btn-again').textContent = result ? 'VOLVER A JUGAR' : 'JUEGO NUEVO';
    if (result) {
      recordLine.textContent = result.isRecord ? '¡NUEVO RÉCORD!' : `RÉCORD: ${result.best}`;
      recordLine.classList.toggle('new-record', result.isRecord);
      board.innerHTML = '';
      board.classList.toggle('hidden', !result.board.length);
      result.board.forEach((e, i) => {
        const li = document.createElement('li');
        li.textContent = `${i + 1}. ${e.score} PTS${e.detail ? ` · ${e.detail}` : ''} · ${e.date}`;
        li.classList.toggle('mine', e.id === result.entry.id);
        board.appendChild(li);
      });
    }
    updateHud();
    showScreen('over');
  }

  function updateHud() {
    if (isKnoid()) return; // KrostNoid escribe su propio marcador
    if (inRun()) {
      renderRogueHud(rogue.hudData());
    } else {
      setHudText(mode === 'com'
        ? `COM · NIVEL ${level + 1} · ${Math.round(difficulty() * 100)}%`
        : `2 JUGADORES · A ${WIN_SCORE}`);
    }
  }

  function setHudText(text) {
    const hud = $('hud');
    hud.className = hud.className.includes('hidden') ? 'hidden' : '';
    hud.textContent = text;
  }

  // HUD del RogueLike: insignia del piso (color del piso + salas), rival y monedas con icono
  let hudCoins = null;
  function renderRogueHud(data) {
    const hud = $('hud');
    if (!data) return;
    hud.classList.add('rogue-hud');
    hud.textContent = '';
    const span = (cls, text = '') => {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = text;
      return s;
    };
    const floor = span(`pill floor ${data.theme}`, `PISO ${data.floor} · ${data.floorName}`);
    const dots = span('dots');
    for (let i = 0; i < data.rooms; i++) {
      dots.appendChild(span('dot' + (i < data.room ? ' done' : '') + (i === data.room ? ' current' : '') + (i === data.rooms - 1 ? ' boss' : '')));
    }
    floor.appendChild(dots);
    hud.appendChild(floor);
    if (data.enemy) hud.appendChild(span(`pill enemy${data.boss ? ' boss' : ''}`, data.enemy));
    const coins = span('pill coins');
    const icon = document.createElement('i');
    icon.className = 'coin';
    coins.append(icon, String(data.coins));
    if (hudCoins !== null && data.coins > hudCoins) coins.classList.add('bump'); // rebote al ganar monedas
    hudCoins = data.coins;
    hud.appendChild(coins);
  }

  // Menú: filas visibles y texto de ayuda según el juego elegido
  function updateMenu() {
    document.querySelector('#menu h1').textContent = isKnoid() ? 'KROSTNOID' : (isRogue() ? 'ROGUE PONG' : 'PONG');
    $('row-mode').classList.toggle('hidden', game !== 'pong');
    $('row-style').classList.toggle('hidden', game !== 'pong');
    const info = $('game-info');
    const saved = isRogue() ? rogue.saveInfo() : null;
    if (isKnoid()) {
      info.textContent = `Rompe todos los ladrillos · RÉCORD: ${bestScore(BOARD_KEYS.krostnoid)}`;
    } else if (isRogue()) {
      info.textContent = saved || `3 pisos · jefes · mejoras · RÉCORD: ${bestScore(BOARD_KEYS.roguelike)}`;
    }
    info.classList.toggle('hidden', game === 'pong');
    $('btn-continue').classList.toggle('hidden', !saved);
    $('btn-start').textContent = saved ? 'NUEVA RUN' : 'INICIO';
    $('help-keys').textContent = isKnoid()
      ? 'Teclado: ← / → mover · Espacio lanzar · P pausa · M sonido'
      : 'Teclado: J1 W / S · J2 ↑ / ↓ · P pausa · M sonido';
    $('help-touch').textContent = isKnoid()
      ? 'Táctil: arrastra para mover · toca para lanzar'
      : 'Táctil: arrastra el dedo en tu mitad de pantalla';
    $('help-goal').classList.toggle('hidden', game !== 'pong');
  }

  // Los mensajes se muestran en cola para que uno no tape a otro (p. ej. NIVEL y AYUDA en el mismo gol)
  const msgQueue = [];
  const MAX_QUEUED_MSGS = 3;

  function showMsg(text, seconds) {
    if (demo) return;
    msgQueue.push([text, seconds]);
    if (msgQueue.length > MAX_QUEUED_MSGS) msgQueue.shift();
    if (msgTimer <= 0) nextMsg();
  }

  function nextMsg() {
    const el = $('msg');
    const next = msgQueue.shift();
    if (!next) {
      el.classList.add('hidden');
      msgTimer = 0;
      return;
    }
    el.textContent = next[0];
    el.classList.remove('hidden');
    msgTimer = next[1];
  }

  function hideMsg() {
    msgQueue.length = 0;
    $('msg').classList.add('hidden');
    msgTimer = 0;
  }

  // Botones de opción del menú (juego, jugadores y estilo visual)
  function select(group, value) {
    const current = { game, mode, style }[group];
    if (group === 'game') game = value;
    else if (group === 'mode') mode = value;
    else style = value;
    document.querySelectorAll(`[data-${group}]`).forEach((b) => b.classList.toggle('selected', b.dataset[group] === value));
    // La demo de fondo vuelve a empezar con lo elegido
    if (demo && current !== value && group !== 'mode') {
      resetMatch();
      showScreen('menu');
    }
    updateMenu();
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

  $('version').textContent = `VERSIÓN ${window.PONG_VERSION}`;
  for (const group of ['game', 'mode', 'style']) {
    document.querySelectorAll(`[data-${group}]`).forEach((b) => b.addEventListener('click', () => select(group, b.dataset[group])));
  }
  $('btn-start').addEventListener('click', newGame);
  $('btn-continue').addEventListener('click', continueRun);
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
    if (demo) return false;
    if (state === 'play' || state === 'serve') pause();
    else if (state === 'paused') resume();
    else if (state === 'over' || state === 'between') toMenu(); // la run queda guardada
    return true;
  };

  // --- Entrada: teclado ---
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (!keys.has(e.code)) keys.set(e.code, ++pressSeq);
    if (e.repeat) return;

    if (e.code === 'KeyM') {
      muted = !muted;
      window.PongAudio.setMuted(muted);
      return;
    }
    // Con un menú abierto, las flechas (y la cruceta del mando en Android) recorren los botones
    if (overlayButtons().length && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      navMove(e.code === 'ArrowUp' || e.code === 'ArrowLeft' ? -1 : 1);
      return;
    }
    const buttonFocused = document.activeElement && document.activeElement.tagName === 'BUTTON';
    if (demo) {
      if (e.code === 'Digit1' || e.code === 'Numpad1') select('mode', 'com');
      else if (e.code === 'Digit2' || e.code === 'Numpad2') select('mode', '2p');
      else if (e.code === 'KeyC') select('style', 'classic');
      else if (e.code === 'KeyX') select('style', 'modern');
      else if (e.code === 'Enter' && !buttonFocused) newGame(); // con un botón enfocado, Enter lo pulsa
      return;
    }
    if (inRun() && state === 'between') {
      rogue.key(e.code); // 1-9 eligen carta o puerta
      return;
    }
    if (isKnoid() && state === 'play' && ['Space', 'ArrowUp', 'KeyW'].includes(e.code)) knoid.launch();
    else if (e.code === 'KeyP' || e.code === 'Escape' || e.code === 'Space') togglePause();
    else if ((e.code === 'KeyN' && !isRogue()) || (state === 'over' && e.code === 'Enter' && !buttonFocused)) newGame();
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    // Con Cmd/Ctrl pulsado algunos navegadores no envían el keyup de las demás teclas
    if (e.key === 'Meta' || e.key === 'Control') keys.clear();
  });

  function releaseAll() {
    keys.clear();
    pointers.clear();
    touchIds.clear();
    touch.left = touch.right = touch.knoid = null;
  }

  // Incrustado (itch.io) cualquier toque en la página de fuera quita el foco al juego: ahí no se pausa
  // ni se sueltan los dedos; solo se pausa de verdad al ocultar la pestaña
  const embedded = window.self !== window.top;
  window.addEventListener('blur', () => {
    keys.clear();
    if (embedded) return;
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
  // Pong horizontal: mitad izquierda = J1, mitad derecha = J2. Vertical: mitad inferior = J1, superior = J2.
  // Contra la COM, toda la pantalla controla a J1. KrostNoid: la paleta sigue al dedo en horizontal.
  function readPointer(e) {
    const r = canvas.getBoundingClientRect();
    if (isKnoid()) return { side: 'knoid', pos: (e.clientX - r.left) / r.width * screenSize().w };
    return portrait
      ? { side: e.clientY > r.top + r.height / 2 ? 'left' : 'right', pos: (e.clientX - r.left) / r.width * H }
      : { side: e.clientX < r.left + r.width / 2 ? 'left' : 'right', pos: (e.clientY - r.top) / r.height * H };
  }

  // Empieza a seguir un dedo/puntero; devuelve la mitad que controla (o null si no toca jugar)
  function grab(e) {
    if (demo || (state !== 'play' && state !== 'serve')) return null;
    if (e.target && e.target.closest && e.target.closest('button')) return null;
    if (embedded) window.focus(); // el teclado y el mando pasan a este marco
    clearPadFocus();
    const p = readPointer(e);
    const side = p.side === 'knoid' || (!vsCom() && game === 'pong') ? p.side : 'left';
    touch[side] = p.pos;
    if (side === 'knoid') knoid.launch();
    return side;
  }

  // Si otro dedo sigue en esa mitad, la paleta lo sigue a él
  const stillHeld = (side) => [...pointers.values(), ...touchIds.values()].includes(side);

  function onPointerDown(e) {
    const side = grab(e);
    if (!side) return;
    pointers.set(e.pointerId, side);
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
    if (!stillHeld(side)) touch[side] = null;
  }

  // Segundo canal con eventos táctiles: algunos navegadores móviles cancelan los eventos de puntero
  // dentro de páginas incrustadas (como itch.io); así el dedo se sigue igualmente
  const touchIds = new Map(); // identificador del toque -> mitad
  function onTouchStart(e) {
    for (const t of e.changedTouches) {
      const side = grab(Object.assign({ target: e.target }, { clientX: t.clientX, clientY: t.clientY }));
      if (side) touchIds.set(t.identifier, side);
    }
    if (touchIds.size) e.preventDefault(); // sin scroll ni zoom de la página mientras se juega
  }

  function onTouchMove(e) {
    let used = false;
    for (const t of e.changedTouches) {
      const side = touchIds.get(t.identifier);
      if (!side) continue;
      touch[side] = readPointer(t).pos;
      used = true;
    }
    if (used) e.preventDefault();
  }

  function onTouchEnd(e) {
    for (const t of e.changedTouches) {
      const side = touchIds.get(t.identifier);
      if (!side) continue;
      touchIds.delete(t.identifier);
      if (!stillHeld(side)) touch[side] = null;
    }
  }

  window.addEventListener('pointerdown', onPointerDown, { passive: false });
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerEnd);
  window.addEventListener('pointercancel', onPointerEnd);
  // Diagnóstico táctil: 5 toques sobre la versión en el menú muestran dónde cae cada dedo
  let versionTaps = 0, touchDebug = null;
  $('version').addEventListener('click', () => {
    if (++versionTaps < 5) return;
    versionTaps = 0;
    if (touchDebug) {
      touchDebug.remove();
      touchDebug = null;
      return;
    }
    touchDebug = document.createElement('div');
    touchDebug.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:99;font:11px monospace;color:#0f0;background:rgba(0,0,0,.7);padding:4px;pointer-events:none;white-space:pre';
    document.body.appendChild(touchDebug);
    touchDebug.textContent = `DIAGNÓSTICO TÁCTIL\nventana ${innerWidth}x${innerHeight} · ${embedded ? 'incrustado' : 'directo'}`;
  });
  const markTouch = (kind, x, y, extra = '') => {
    if (!touchDebug) return;
    const dot = document.createElement('div');
    dot.style.cssText = `position:fixed;left:${x - 6}px;top:${y - 6}px;width:12px;height:12px;border-radius:50%;background:${kind === 'touch' ? '#0f0' : '#f0f'};z-index:98;pointer-events:none`;
    document.body.appendChild(dot);
    setTimeout(() => dot.remove(), 1200);
    const lines = touchDebug.textContent.split('\n').slice(0, 2);
    touchDebug.textContent = `${lines.join('\n')}\n${kind} ${Math.round(x)},${Math.round(y)} ${extra} · estado ${state}`;
  };
  window.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) markTouch('touch', t.clientX, t.clientY, e.target.id || e.target.tagName); }, true);
  window.addEventListener('pointerdown', (e) => markTouch('pointer', e.clientX, e.clientY, e.pointerType), true);
  window.addEventListener('touchcancel', () => markTouch('touch', 0, 0, 'CANCELADO'), true);
  window.addEventListener('pointercancel', () => markTouch('pointer', 0, 0, 'CANCELADO'), true);

  // iOS Safari: bloquear el zoom con dos dedos y el doble toque, que roban el gesto al juego
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
  // Durante la partida, cualquier dedo que se mueva fuera de un botón es del juego, aunque haya
  // empezado fuera del área que sigue: así iOS no lo convierte en scroll de la página de fuera
  document.addEventListener('touchmove', (e) => {
    if ((state === 'play' || state === 'serve') && !(e.target.closest && e.target.closest('button, .overlay'))) e.preventDefault();
  }, { passive: false });
  window.addEventListener('touchstart', onTouchStart, { passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd);
  window.addEventListener('touchcancel', onTouchEnd);
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);

  // --- Entrada: mando ---
  // Gamepad API (navegador y APK) para palanca, cruceta y botones. La APK además reenvía el mando
  // nativo de Android (onNativePad / onNativeButton) por si su WebView no expone el Gamepad API.
  const PAD_DEADZONE = 0.3, NAV_REPEAT = 0.28, NAV_DEBOUNCE = 60;
  const pads = [{ x: 0, y: 0 }, { x: 0, y: 0 }]; // J1 y J2: -1..1 (palanca o cruceta)
  const nativePad = { x: 0, y: 0 };
  const padPrev = [{}, {}];
  let navHeld = 0, navTimer = 0, lastNav = -Infinity, padInUse = false;
  let clock = 0; // tiempo de juego en ms (avanza con cada fotograma)

  const dead = (v) => (Math.abs(v) < PAD_DEADZONE ? 0 : v);
  const connectedPads = () => (navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []);

  window.onNativePad = (x, y) => {
    nativePad.x = dead(x);
    nativePad.y = dead(y);
  };
  window.onNativeButton = (name) => {
    if (connectedPads().length) return; // el Gamepad API ya lo está leyendo
    padInUse = true;
    padPress(name);
  };

  // Botones del menú abierto (menú, pausa, resultados o pantallas del RogueLike)
  function overlayButtons() {
    const open = ['menu', 'pause', 'over', 'rogue'].map($).find((el) => !el.classList.contains('hidden'));
    return open ? [...open.querySelectorAll('button')].filter((b) => !b.disabled && b.offsetParent !== null) : [];
  }

  function clearPadFocus() {
    document.querySelectorAll('.pad-focus').forEach((b) => b.classList.remove('pad-focus'));
  }

  function focusButton(b) {
    clearPadFocus();
    b.classList.add('pad-focus');
    b.focus({ preventScroll: true });
  }

  function navMove(delta) {
    const list = overlayButtons();
    if (!list.length) return;
    if (clock - lastNav < NAV_DEBOUNCE) return; // cruceta = flecha + botón del mando: un solo paso
    lastNav = clock;
    padInUse = true;
    const i = list.indexOf(document.activeElement);
    focusButton(list[i < 0 ? 0 : (i + delta + list.length) % list.length]);
  }

  // A: pulsar / lanzar · B: atrás · Start: pausa (o pulsar en un menú)
  function padPress(name) {
    const list = overlayButtons();
    if (list.length && (name === 'a' || name === 'start')) {
      const target = list.includes(document.activeElement) ? document.activeElement : list[0];
      if (!list.includes(document.activeElement)) focusButton(target);
      target.click();
    } else if (name === 'a' && isKnoid() && state === 'play') {
      knoid.launch();
    } else if (name === 'start' && (state === 'play' || state === 'serve')) {
      pause();
    } else if (name === 'b') {
      window.onAndroidBack();
    }
  }

  function pollPads(dt) {
    const list = connectedPads();
    for (let i = 0; i < 2; i++) {
      const g = list[i];
      let x = 0, y = 0;
      if (g) {
        const pressed = (n) => !!(g.buttons[n] && g.buttons[n].pressed);
        x = dead(g.axes[0] || 0) || dead(g.axes[2] || 0); // palanca izquierda (o la derecha)
        y = dead(g.axes[1] || 0) || dead(g.axes[3] || 0);
        if (pressed(12)) y = -1;
        if (pressed(13)) y = 1;
        if (pressed(14)) x = -1;
        if (pressed(15)) x = 1;
        for (const [n, name] of [[0, 'a'], [1, 'b'], [9, 'start']]) {
          if (pressed(n) && !padPrev[i][n]) {
            padInUse = true;
            padPress(name);
          }
          padPrev[i][n] = pressed(n);
        }
      } else if (i === 0) {
        x = nativePad.x;
        y = nativePad.y;
      }
      pads[i].x = x;
      pads[i].y = y;
      if (x || y) padInUse = true;
    }
    // En los menús, la palanca de J1 mueve el foco (con repetición si se mantiene)
    const dir = Math.abs(pads[0].y) > 0.5 ? Math.sign(pads[0].y) : (Math.abs(pads[0].x) > 0.5 ? Math.sign(pads[0].x) : 0);
    if (!dir || !overlayButtons().length) {
      navHeld = 0;
    } else if (dir !== navHeld || (navTimer -= dt) <= 0) {
      navMove(dir);
      navTimer = dir !== navHeld ? NAV_REPEAT * 1.6 : NAV_REPEAT;
      navHeld = dir;
    }
  }

  // Dirección de la paleta de un jugador con el mando: en horizontal la palanca va arriba/abajo;
  // en vertical la cancha está girada y la paleta se mueve con izquierda/derecha
  const padAxis = (i) => (portrait ? pads[i].x : pads[i].y);

  // Un mismo botón no se pulsa dos veces seguidas (p. ej. Enter + botón A del mando a la vez)
  let lastClick = { el: null, t: -Infinity };
  document.addEventListener('click', (e) => {
    const now = clock;
    if (e.target === lastClick.el && now - lastClick.t < 200) {
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    lastClick = { el: e.target, t: now };
  }, true);

  // --- Bucle principal ---
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    clock += dt * 1000;
    pollPads(dt);
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // Solo para pruebas automáticas: index.html?debug expone el estado interno
  if (/[?&]debug\b/.test(location.search)) {
    window.__pong = { ball, left, right, powerups, knoid, rogue, modern, touch, pads, overlayButtons, padPress, get state() { return state; } };
  }

  layout();
  toMenu();
  requestAnimationFrame(frame);
})();
