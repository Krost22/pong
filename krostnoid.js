// KrostNoid: rompeladrillos estilo Arkanoid con niveles, cápsulas de poder y récords.
// Comparte el canvas con Pong pero trabaja en coordenadas de pantalla (no gira): la paleta siempre va abajo.
// game.js crea la instancia (api) y le pasa la entrada; este módulo solo simula y dibuja.
window.PongKrostnoid = (api) => {
  'use strict';

  const { ctx } = api;
  const sfx = () => api.sfx();

  const COLS = 12, TOP = 20, SIDE = 4, BRICK_H = 7;
  const PADDLE_BOTTOM = 10, PADDLE_H = 4, PADDLE_W = 30, PADDLE_W_BIG = 46;
  const PADDLE_SPEED = 230, TOUCH_SPEED = 1400, RESIZE_SPEED = 60;
  const BALL = 4, BALL_SPEED = 120, BALL_MAX = 230, LEVEL_SPEEDUP = 0.08;
  const MIN_ANGLE = 0.18; // radianes respecto a la vertical
  const START_LIVES = 3, MAX_LIVES = 5;
  const CAPSULE_CHANCE = 0.18, CAPSULE_SPEED = 45, CAPSULE_W = 12, CAPSULE_H = 6;
  const EXPAND_TIME = 15, LASER_TIME = 10, LASER_RATE = 0.35, LASER_SPEED = 240;
  const AUTO_LAUNCH = 2.5, CLEAR_PAUSE = 1.8;
  const MAX_STEP = 1 / 240;

  // 12 columnas. 1-6 = colores (1 golpe), S = plata (2 golpes), G = oro (indestructible), . = vacío
  const LEVELS = [
    [
      '............',
      '111111111111',
      '222222222222',
      '333333333333',
      '444444444444',
      '555555555555',
    ],
    [
      '.....66.....',
      '....5555....',
      '...444444...',
      '..33333333..',
      '.2222222222.',
      '111111111111',
    ],
    [
      'SSSSSSSSSSSS',
      '1.1.1.1.1.1.',
      '.2.2.2.2.2.2',
      '3.3.3.3.3.3.',
      '.4.4.4.4.4.4',
      '5.5.5.5.5.5.',
    ],
    [
      '..55....55..',
      '.5445..5445.',
      '.5445..5445.',
      '..55....55..',
      'GG..GGGG..GG',
      '111111111111',
    ],
    [
      '..2......2..',
      '...2....2...',
      '..SSSSSSSS..',
      '.SS6SSSS6SS.',
      'SSSSSSSSSSSS',
      'S.SSSSSSSS.S',
      'S.S......S.S',
      '...33..33...',
    ],
  ];

  // [claro, base, oscuro]
  const BRICKS = {
    1: { colors: ['#ffb3ad', '#ff5a4f', '#a8261f'], hits: 1, points: 70 },
    2: { colors: ['#ffd1a3', '#ff9f3f', '#b8601a'], hits: 1, points: 60 },
    3: { colors: ['#fff2b0', '#ffd23f', '#c99a12'], hits: 1, points: 50 },
    4: { colors: ['#d2f7c0', '#7ee05a', '#3f9a2c'], hits: 1, points: 40 },
    5: { colors: ['#b8e2ff', '#3fa7ff', '#1d5fa8'], hits: 1, points: 30 },
    6: { colors: ['#e2ccff', '#b07cff', '#6f45b8'], hits: 1, points: 80 },
    S: { colors: ['#f4f7fa', '#c8d0d8', '#7d8894'], hits: 2, points: 100 },
    G: { colors: ['#fff0b8', '#e8b83a', '#9a7414'], hits: Infinity, points: 0 },
  };

  const CAPSULES = [
    { id: 'E', name: 'EXPANDIR', colors: ['#7ee05a', '#3f9a2c'] },
    { id: 'M', name: 'MULTIBOLA', colors: ['#3fa7ff', '#1d5fa8'] },
    { id: 'L', name: 'LÁSER', colors: ['#ff5a4f', '#a8261f'] },
    { id: 'S', name: 'LENTO', colors: ['#ffd23f', '#c99a12'] },
    { id: 'V', name: 'VIDA EXTRA', colors: ['#ff8fd8', '#c2559f'] },
  ];
  // Letras de 3x5 para las cápsulas
  const GLYPHS = {
    E: '111100111100111', M: '101111111101101', L: '100100100100111', S: '111100111001111', V: '101101101101010',
  };

  let bricks = [], balls = [], capsules = [], lasers = [], particles = [], stars = [];
  let level = 0, lives = START_LIVES, score = 0;
  const paddle = { x: 0, w: PADDLE_W, expand: 0, laser: 0, cooldown: 0, flash: 0 };
  let size = { w: 0, h: 0 };
  let stuckTimer = 0, clearing = 0, shake = 0, time = 0;
  let demo = false, hintShown = false;
  let hud = '';

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const snap = api.snap;
  const fill = (x, y, w, h) => ctx.fillRect(snap(x), snap(y), w, h);
  const paddleY = () => size.h - PADDLE_BOTTOM;
  const speed = () => Math.min(BALL_SPEED * (1 + LEVEL_SPEEDUP * level), BALL_MAX);

  // --- Geometría (se recalcula si cambia el tamaño o la orientación) ---
  function brickW() {
    return Math.floor((size.w - SIDE * 2) / COLS);
  }

  function brickRect(b) {
    const bw = brickW();
    const left = Math.floor((size.w - bw * COLS) / 2);
    return { x: left + b.c * bw, y: TOP + b.r * BRICK_H, w: bw, h: BRICK_H };
  }

  function syncSize() {
    const s = api.screenSize();
    if (s.w === size.w && s.h === size.h) return;
    if (size.w) {
      const rx = s.w / size.w, ry = s.h / size.h;
      paddle.x *= rx;
      for (const list of [balls, capsules, lasers, particles]) {
        for (const o of list) { o.x *= rx; o.y *= ry; }
      }
    }
    size = { w: s.w, h: s.h };
    stars = [];
    for (let i = 0; i < 70; i++) stars.push({ x: Math.floor(rand(0, size.w)), y: Math.floor(rand(0, size.h)), phase: rand(0, 6), big: Math.random() < 0.15 });
  }

  // --- Partida ---
  function start(isDemo) {
    syncSize();
    demo = isDemo;
    hintShown = false;
    hud = '';
    lives = START_LIVES;
    score = 0;
    paddle.x = size.w / 2;
    loadLevel(0);
  }

  function loadLevel(n) {
    level = n;
    const map = LEVELS[n % LEVELS.length];
    bricks = [];
    map.forEach((row, r) => [...row].forEach((ch, c) => {
      if (ch === '.') return;
      // A partir de la segunda vuelta, la plata aguanta un golpe más
      const hits = ch === 'S' ? BRICKS.S.hits + Math.floor(n / LEVELS.length) : BRICKS[ch].hits;
      bricks.push({ c, r, type: ch, hits, flash: 0 });
    }));
    capsules = [];
    lasers = [];
    clearing = 0;
    resetPaddle();
    newBall();
    api.showMsg(`NIVEL ${n + 1}`, 1.5);
  }

  function resetPaddle() {
    paddle.expand = paddle.laser = 0;
  }

  function newBall() {
    balls = [{ x: paddle.x - BALL / 2, y: paddleY() - BALL, vx: 0, vy: 0, stuck: true, offset: rand(-6, 6), trail: [] }];
    stuckTimer = AUTO_LAUNCH;
    if (!demo && !hintShown) {
      hintShown = true;
      api.showMsg('TOCA PARA LANZAR', 1.6);
    }
  }

  function launch() {
    for (const b of balls) {
      if (!b.stuck) continue;
      b.stuck = false;
      const a = rand(-0.5, 0.5);
      b.vx = Math.sin(a) * speed();
      b.vy = -Math.cos(a) * speed();
      sfx().serve();
    }
  }

  function loseLife() {
    lives--;
    shake = 0.4;
    sfx().lifeLost();
    resetPaddle();
    if (lives <= 0) {
      if (demo) start(true);
      else api.onGameOver(score, level + 1);
      return;
    }
    newBall();
  }

  // --- Ladrillos y cápsulas ---
  function burst(x, y, colors, n, sp) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(sp * 0.3, sp);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.25, 0.55), max: 0.55, color: pick(colors) });
    }
  }

  function damage(br) {
    const def = BRICKS[br.type];
    br.flash = 0.12;
    if (def.hits === Infinity) {
      sfx().clink();
      return;
    }
    if (--br.hits > 0) {
      sfx().clink();
      return;
    }
    bricks.splice(bricks.indexOf(br), 1);
    const r = brickRect(br);
    score += Math.round(def.points * (1 + level * 0.1));
    burst(r.x + r.w / 2, r.y + r.h / 2, def.colors, 12, 70);
    sfx().brick(br.r);
    if (!capsules.length && Math.random() < CAPSULE_CHANCE) {
      const type = pick(lives >= MAX_LIVES ? CAPSULES.filter((k) => k.id !== 'V') : CAPSULES);
      capsules.push({ x: r.x + r.w / 2 - CAPSULE_W / 2, y: r.y, type, t: 0 });
    }
    if (!bricks.some((b) => b.type !== 'G')) {
      clearing = CLEAR_PAUSE;
      balls = [];
      api.showMsg('¡NIVEL SUPERADO!', 1.5);
      sfx().levelClear();
    }
  }

  function applyCapsule(type) {
    api.showMsg(type.name, 1.2);
    sfx().powerup();
    burst(paddle.x, paddleY(), type.colors.concat('#ffffff'), 20, 90);
    switch (type.id) {
      case 'E': paddle.expand = EXPAND_TIME; break;
      case 'L': paddle.laser = LASER_TIME; paddle.cooldown = 0; break;
      case 'V': lives = Math.min(MAX_LIVES, lives + 1); break;
      case 'S':
        for (const b of balls) {
          const s = Math.hypot(b.vx, b.vy) || 1;
          const target = BALL_SPEED * 0.8;
          b.vx *= target / s;
          b.vy *= target / s;
        }
        break;
      case 'M': {
        launch();
        const extra = [];
        for (const b of balls) {
          const s = Math.hypot(b.vx, b.vy), a = Math.atan2(b.vx, -b.vy);
          for (const d of [-0.45, 0.45]) {
            extra.push({ x: b.x, y: b.y, vx: Math.sin(a + d) * s, vy: -Math.abs(Math.cos(a + d) * s), stuck: false, trail: [] });
          }
        }
        balls.push(...extra.slice(0, 8));
        break;
      }
    }
  }

  // --- Simulación ---
  function movePaddle(dt) {
    let target = null;
    if (demo) {
      // La demo sigue a la bola que más baja y apunta un poco a un lado para variar el ángulo
      const falling = balls.filter((b) => !b.stuck && b.vy > 0).sort((a, b) => b.y - a.y)[0];
      target = falling ? falling.x + BALL / 2 + Math.sin(time) * paddle.w * 0.3 : size.w / 2;
    } else {
      const dir = api.axis(['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']);
      if (dir) paddle.x += dir * PADDLE_SPEED * dt;
      else if (api.touchX() !== null) target = api.touchX();
    }
    if (target !== null) paddle.x += clamp(target - paddle.x, -TOUCH_SPEED * dt, TOUCH_SPEED * dt);
    const targetW = paddle.expand > 0 ? PADDLE_W_BIG : PADDLE_W;
    paddle.w += clamp(targetW - paddle.w, -RESIZE_SPEED * dt, RESIZE_SPEED * dt);
    paddle.x = clamp(paddle.x, paddle.w / 2, size.w - paddle.w / 2);
  }

  function stepBall(b, dt) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.x < 0) { b.x = 0; b.vx = Math.abs(b.vx); sfx().wall(); }
    else if (b.x > size.w - BALL) { b.x = size.w - BALL; b.vx = -Math.abs(b.vx); sfx().wall(); }
    if (b.y < 0) { b.y = 0; b.vy = Math.abs(b.vy); sfx().wall(); }

    // Paleta: el ángulo depende de dónde golpea (hasta 60°)
    const py = paddleY();
    if (b.vy > 0 && b.y + BALL >= py && b.y + BALL <= py + PADDLE_H + 3 &&
        b.x + BALL > paddle.x - paddle.w / 2 && b.x < paddle.x + paddle.w / 2) {
      const rel = clamp((b.x + BALL / 2 - paddle.x) / (paddle.w / 2), -1, 1);
      let a = rel * Math.PI / 3;
      // Nunca totalmente vertical: evita bucles infinitos arriba-abajo por la misma columna
      if (Math.abs(a) < MIN_ANGLE) a = (rel < 0 || (rel === 0 && Math.random() < 0.5) ? -1 : 1) * MIN_ANGLE;
      const s = Math.max(Math.hypot(b.vx, b.vy), BALL_SPEED * 0.8);
      b.vx = Math.sin(a) * s;
      b.vy = -Math.cos(a) * s;
      b.y = py - BALL;
      paddle.flash = 0.12;
      sfx().hit(clamp((s - BALL_SPEED) / (BALL_MAX - BALL_SPEED), 0, 1));
    }

    // Ladrillos: rebota por el lado de menor penetración
    for (const br of bricks) {
      const r = brickRect(br);
      if (b.x + BALL <= r.x || b.x >= r.x + r.w || b.y + BALL <= r.y || b.y >= r.y + r.h) continue;
      const ox = Math.min(b.x + BALL - r.x, r.x + r.w - b.x);
      const oy = Math.min(b.y + BALL - r.y, r.y + r.h - b.y);
      if (ox < oy) b.vx = (b.x + BALL / 2 < r.x + r.w / 2 ? -1 : 1) * Math.abs(b.vx);
      else b.vy = (b.y + BALL / 2 < r.y + r.h / 2 ? -1 : 1) * Math.abs(b.vy);
      damage(br);
      break;
    }
  }

  function update(dt) {
    syncSize();
    time += dt;
    shake = Math.max(0, shake - dt);
    paddle.flash = Math.max(0, paddle.flash - dt);
    for (const br of bricks) br.flash = Math.max(0, br.flash - dt);
    for (let k = particles.length - 1; k >= 0; k--) {
      const p = particles[k];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 3 * dt;
      p.vy = p.vy * (1 - 3 * dt) + 60 * dt;
      if ((p.life -= dt) <= 0) particles.splice(k, 1);
    }

    if (clearing > 0) {
      if ((clearing -= dt) <= 0) loadLevel(level + 1);
      return;
    }

    movePaddle(dt);
    paddle.expand = Math.max(0, paddle.expand - dt);
    paddle.laser = Math.max(0, paddle.laser - dt);

    // Láser: dispara solo, dos rayos desde los extremos de la paleta
    if (paddle.laser > 0 && (paddle.cooldown -= dt) <= 0) {
      paddle.cooldown = LASER_RATE;
      for (const dx of [-paddle.w / 2 + 2, paddle.w / 2 - 3]) lasers.push({ x: paddle.x + dx, y: paddleY() - 3 });
      sfx().laser();
    }

    for (const b of balls) {
      if (b.stuck) {
        b.x = paddle.x + b.offset - BALL / 2;
        b.y = paddleY() - BALL;
      }
    }
    if (balls.some((b) => b.stuck) && (stuckTimer -= dt) <= 0) launch();

    for (const b of balls) {
      if (b.stuck) continue;
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 6) b.trail.shift();
      for (let t = dt; t > 0 && clearing <= 0; t -= MAX_STEP) stepBall(b, Math.min(t, MAX_STEP));
    }
    if (clearing > 0) return;
    balls = balls.filter((b) => b.y < size.h);
    if (!balls.length) {
      loseLife();
      return;
    }

    for (let k = capsules.length - 1; k >= 0; k--) {
      const c = capsules[k];
      c.y += CAPSULE_SPEED * dt;
      c.t += dt;
      const py = paddleY();
      if (c.y + CAPSULE_H >= py && c.y <= py + PADDLE_H && c.x + CAPSULE_W >= paddle.x - paddle.w / 2 && c.x <= paddle.x + paddle.w / 2) {
        capsules.splice(k, 1);
        applyCapsule(c.type);
      } else if (c.y > size.h) {
        capsules.splice(k, 1);
      }
    }

    for (let k = lasers.length - 1; k >= 0; k--) {
      const l = lasers[k];
      l.y -= LASER_SPEED * dt;
      const hitBrick = bricks.find((br) => {
        const r = brickRect(br);
        return l.x >= r.x && l.x < r.x + r.w && l.y < r.y + r.h && l.y + 3 > r.y;
      });
      if (hitBrick) {
        lasers.splice(k, 1);
        damage(hitBrick);
        if (clearing > 0) return;
      } else if (l.y < 0) {
        lasers.splice(k, 1);
      }
    }

    const best = api.record();
    const text = `NIVEL ${level + 1} · VIDAS ${lives} · ${score} PTS` + (demo ? '' : ` · RÉCORD ${Math.max(best, score)}`);
    if (text !== hud) {
      hud = text;
      api.setHud(text);
    }
  }

  // --- Dibujo ---
  function drawBrick(br) {
    const r = brickRect(br);
    const [light, base, dark] = br.flash > 0 ? ['#ffffff', '#ffffff', '#ffffff'] : BRICKS[br.type].colors;
    const x = r.x, y = r.y, w = r.w - 1, h = r.h - 1;
    ctx.fillStyle = dark;
    fill(x, y, w, h);
    ctx.fillStyle = base;
    fill(x, y, w - 1, h - 1);
    ctx.fillStyle = light;
    fill(x, y, w - 1, 1);
    fill(x, y, 1, h - 1);
    if (br.type === 'G') {
      // Brillo que recorre el oro
      const shine = Math.floor((time * 30 + br.c * 7) % (w + 20)) - 10;
      if (shine >= 0 && shine < w - 1) {
        ctx.fillStyle = '#ffffff';
        fill(x + shine, y + 1, 1, h - 2);
      }
    } else if (br.type === 'S' && br.hits < BRICKS.S.hits + Math.floor(level / LEVELS.length)) {
      ctx.fillStyle = dark; // grietas
      fill(x + 3, y + 2, 1, 1);
      fill(x + 4, y + 3, 1, 1);
      fill(x + w - 5, y + 1, 1, 2);
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      fill(x + 2, y + 1, 2, 1);
    }
  }

  function drawCapsule(c) {
    const [base, dark] = c.type.colors;
    const x = Math.round(c.x), y = Math.round(c.y);
    ctx.fillStyle = dark;
    fill(x + 1, y, CAPSULE_W - 2, CAPSULE_H);
    fill(x, y + 1, CAPSULE_W, CAPSULE_H - 2);
    ctx.fillStyle = base;
    fill(x + 1, y + 1, CAPSULE_W - 2, CAPSULE_H - 3);
    // La letra gira: se dibuja comprimida a ratos
    const bits = GLYPHS[c.type.id];
    const squash = Math.cos(c.t * 5) > -0.3;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 15; i++) {
      if (bits[i] !== '1') continue;
      const gx = i % 3, gy = Math.floor(i / 3);
      if (squash || gx === 1) fill(x + 4 + gx, y + gy * 0.8, 1, 1);
    }
  }

  function drawPaddle() {
    const py = paddleY();
    const x = Math.round(paddle.x - paddle.w / 2), w = Math.round(paddle.w);
    const flash = paddle.flash > 0;
    ctx.fillStyle = 'rgba(63, 167, 255, 0.25)'; // resplandor
    fill(x - 2, py - 2, w + 4, PADDLE_H + 4);
    ctx.fillStyle = flash ? '#ffffff' : '#7d8894';
    fill(x + 1, py, w - 2, PADDLE_H);
    ctx.fillStyle = flash ? '#ffffff' : '#c8d0d8';
    fill(x + 1, py, w - 2, PADDLE_H - 1);
    ctx.fillStyle = '#f4f7fa';
    fill(x + 4, py, w - 8, 1);
    // Extremos rojos (o cañones en modo láser)
    ctx.fillStyle = paddle.laser > 0 ? '#ffd23f' : '#ff5a4f';
    fill(x, py, 4, PADDLE_H);
    fill(x + w - 4, py, 4, PADDLE_H);
    if (paddle.laser > 0) {
      ctx.fillStyle = '#ff5a4f';
      fill(x + 1, py - 2, 2, 2);
      fill(x + w - 3, py - 2, 2, 2);
    }
  }

  function draw() {
    syncSize();
    ctx.fillStyle = '#0b1026';
    ctx.fillRect(0, 0, size.w, size.h);

    ctx.save();
    if (shake > 0) ctx.translate(Math.round(rand(-3, 3) * shake * 3), Math.round(rand(-3, 3) * shake * 3));

    for (const s of stars) {
      const on = Math.sin(time * 1.5 + s.phase);
      ctx.fillStyle = on > 0.6 ? '#ffffff' : '#3a4a7a';
      ctx.fillRect(s.x, s.y, s.big ? 2 : 1, s.big ? 2 : 1);
    }
    // Marco lateral metálico
    ctx.fillStyle = '#2a355e';
    ctx.fillRect(0, 0, size.w, 1);
    ctx.fillRect(0, 0, 1, size.h);
    ctx.fillRect(size.w - 1, 0, 1, size.h);

    for (const br of bricks) drawBrick(br);
    for (const c of capsules) drawCapsule(c);

    ctx.fillStyle = '#ff7a7a';
    for (const l of lasers) fill(l.x, l.y, 1, 3);

    drawPaddle();

    for (const b of balls) {
      b.trail.forEach((p, i) => {
        ctx.fillStyle = `rgba(160, 200, 255, ${(i + 1) / b.trail.length * 0.4})`;
        fill(p.x + 1, p.y + 1, 2, 2);
      });
      ctx.fillStyle = '#ffffff';
      fill(b.x + 1, b.y, 2, 4);
      fill(b.x, b.y + 1, 4, 2);
      ctx.fillStyle = '#9fb8d8';
      fill(b.x + 3, b.y + 2, 1, 1);
      fill(b.x + 2, b.y + 3, 1, 1);
    }

    for (const p of particles) {
      ctx.globalAlpha = Math.min(1, p.life / p.max * 1.5);
      ctx.fillStyle = p.color;
      fill(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  return {
    start, update, draw, launch,
    get score() { return score; },
    get balls() { return balls; },
    get level() { return level; },
    get bricksLeft() { return bricks.filter((b) => b.type !== 'G').length; },
  };
};
