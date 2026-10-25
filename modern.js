// Modo moderno: pixel art a color sobre césped que reacciona a la pelota,
// chispas, estela, confeti y onda expansiva en los goles.
// game.js crea la instancia pasándole su estado (api) y llama a los eventos on*.
window.PongModern = (api) => {
  'use strict';

  const { ctx, W, PADDLE_W, BALL_SIZE, BALL_MAX_SPEED, left, right, ball, powerups } = api;

  const C = {
    border: '#235a21',
    grassA: '#3f9a3c', grassB: '#48a744',
    bladeDark: '#2f7a2d', bladeLight: '#74c94f', bladeTip: '#a6e86b', bladeFlat: '#b8ec84',
    chalk: 'rgba(240, 255, 230, 0.7)',
    shadow: 'rgba(15, 50, 15, 0.4)',
    ball: '#fff8dc', ballShade: '#d6c48a',
    trail: '255, 240, 170',
    p1: ['#a8dcff', '#3fa7ff', '#1d5fa8'], // claro, base, oscuro
    p2: ['#ffb8ad', '#ff5a4f', '#a8261f'],
    ice: ['#f0fcff', '#9fe6ff', '#4aa8d8'],
  };
  // Pelota según su estado: [cuerpo, sombra, brillo]
  const BALL_LOOK = {
    normal: ['#fff8dc', '#d6c48a', '#ffffff'],
    fire: ['#ffe066', '#ff6a1f', '#ffffff'],
    slow: ['#b8f0ff', '#4aa8d8', '#ffffff'],
  };
  const FIRE_SPEED = 215; // a partir de esta velocidad la pelota arde
  const CONFETTI = ['#ff5a4f', '#ffd23f', '#3fa7ff', '#7ee05a', '#ff8fd8', '#ffffff', '#b07cff'];

  // Resorte blando: la hierba tarda ~1 s en volver a su sitio tras pasar la pelota
  const BLADE_STEP = 6, BLADE_MAX = 3, BLADE_K = 28, BLADE_DAMP = 4.5;
  const BALL_GRASS_RADIUS = 11;
  const PRESS_RECOVERY = 0.55; // por segundo: rastro de hierba aplastada que se desvanece
  const WAVE_SPEED = 260, WAVE_LIFE = 0.9;
  const FLASH_LIFE = 0.45;
  const CENTER_RADIUS = 22;

  let blades = [], cols = 0, rows = 0, fieldH = 0;
  let circle = [];
  const sparks = [];   // coordenadas de campo
  const confetti = []; // coordenadas de pantalla: la gravedad siempre cae hacia abajo, gire o no el móvil
  const waves = [];
  const flashes = [];
  const trail = [];
  const paddleFlash = { left: 0, right: 0 };
  let shake = 0, time = 0;
  let burning = false;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  // --- Construcción del campo (se rehace si cambia la proporción de la pantalla) ---
  function buildField() {
    const H = api.H;
    fieldH = H;
    cols = Math.ceil(W / BLADE_STEP);
    rows = Math.ceil(H / BLADE_STEP);
    blades = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        let lx = 0, ly = 0;
        while (!lx && !ly) { lx = Math.round(rand(-1, 1)); ly = Math.round(rand(-1, 1)); }
        blades.push({
          x: Math.min(W - 1, i * BLADE_STEP + Math.floor(rand(0, BLADE_STEP))),
          y: Math.min(H - 1, j * BLADE_STEP + Math.floor(rand(0, BLADE_STEP))),
          lx, ly, // hacia dónde se inclina la brizna en reposo
          bx: 0, by: 0, vx: 0, vy: 0, // flexión y velocidad del resorte
          press: 0, fx: 0, fy: 0, // aplastamiento (1 = recién pisada) y hacia dónde quedó tumbada
          phase: rand(0, Math.PI * 2),
          tall: Math.random() < 0.3,
        });
      }
    }

    const seen = new Set();
    circle = [];
    for (let a = 0; a < 360; a += 1.5) {
      const px = Math.round(Math.cos(a * Math.PI / 180) * CENTER_RADIUS);
      const py = Math.round(Math.sin(a * Math.PI / 180) * CENTER_RADIUS);
      if (!seen.has(`${px},${py}`)) {
        seen.add(`${px},${py}`);
        circle.push([px, py]);
      }
    }
  }

  function ensureField() {
    if (fieldH !== api.H) buildField();
  }

  function reset() {
    ensureField();
    sparks.length = confetti.length = waves.length = flashes.length = trail.length = 0;
    paddleFlash.left = paddleFlash.right = 0;
    shake = 0;
    burning = false;
    for (const b of blades) b.bx = b.by = b.vx = b.vy = b.press = 0;
  }

  // --- Eventos del juego ---
  function onHit(side, dir) {
    const p = side === 'left' ? left : right;
    const colors = side === 'left' ? C.p1 : C.p2;
    paddleFlash[side] = 0.15;
    const x = dir > 0 ? p.x + PADDLE_W : p.x;
    const y = ball.y + BALL_SIZE / 2;
    for (let i = 0; i < 14; i++) {
      const a = rand(-1.2, 1.2), sp = rand(40, 130);
      sparks.push({ x, y, vx: Math.cos(a) * sp * dir, vy: Math.sin(a) * sp, life: rand(0.2, 0.45), max: 0.45,
        color: Math.random() < 0.5 ? colors[0] : '#ffffff' });
    }
    shake = Math.max(shake, 0.06);
  }

  function onWall() {
    const top = ball.y < api.H / 2;
    for (let i = 0; i < 6; i++) {
      sparks.push({ x: ball.x + BALL_SIZE / 2, y: top ? 1 : api.H - 2, vx: rand(-50, 50) + ball.vx * 0.2,
        vy: (top ? 1 : -1) * rand(20, 60), life: rand(0.2, 0.35), max: 0.35, color: C.bladeTip });
    }
  }

  function onGoal(scorer, y) {
    const concededLeft = scorer === 'right';
    waves.push({ x: concededLeft ? 0 : W, y, t: 0 });
    flashes.push({ concededLeft, t: 0 });
    shake = 0.35;
    burstConfetti(scorer, 90);
  }

  function onWin(side) {
    burstConfetti(side, 160);
  }

  // Chispas en todas direcciones (coordenadas de campo); la usan los power-ups
  function burst(x, y, colors, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(speed * 0.3, speed);
      sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.25, 0.55), max: 0.55, color: pick(colors) });
    }
  }

  function addShake(seconds) {
    shake = Math.max(shake, seconds);
  }

  // Fuego: llamas que salen de la pelota hacia atrás y suben como humo al apagarse
  function emitFire(dt) {
    const speed = Math.hypot(ball.vx, ball.vy);
    const hot = api.state === 'play' && speed >= FIRE_SPEED && !powerups.slowBall;
    if (hot && !burning) {
      window.PongAudio.modern.ignite();
      burst(ball.x + BALL_SIZE / 2, ball.y + BALL_SIZE / 2, ['#ffe066', '#ff6a1f'], 14, 70);
    }
    burning = hot;
    if (!hot) return;
    const intensity = clamp((speed - FIRE_SPEED) / (BALL_MAX_SPEED - FIRE_SPEED), 0, 1);
    const n = Math.round((90 + 160 * intensity) * dt) + 1;
    for (let i = 0; i < n; i++) {
      sparks.push({ x: ball.x + rand(0, BALL_SIZE), y: ball.y + rand(0, BALL_SIZE),
        vx: -ball.vx * rand(0.05, 0.2) + rand(-25, 25), vy: -ball.vy * rand(0.05, 0.2) + rand(-25, 25),
        life: rand(0.18, 0.4 + 0.2 * intensity), max: 0.6, fire: true });
    }
  }

  function fireColor(k) {
    if (k > 0.75) return '#fff3b0';
    if (k > 0.5) return '#ffb42e';
    if (k > 0.3) return '#ff5a1f';
    return 'rgba(70, 60, 55, 0.7)'; // humo
  }

  function burstConfetti(side, n) {
    const box = api.scoreBoxes()[side];
    const score = side === 'left' ? left.score : right.score;
    const x = box.x + api.numberWidth(score, box.s) / 2;
    const y = box.y + box.s * 2.5;
    for (let i = 0; i < n; i++) {
      confetti.push({ x, y, vx: rand(-100, 100), vy: rand(-190, -40), life: rand(1.6, 2.8),
        color: pick(CONFETTI), spin: rand(6, 14), phase: rand(0, 6) });
    }
  }

  // --- Simulación ---
  function pushGrass(cx, cy, radius, dirX, dirY, strength) {
    const i0 = clamp(Math.floor((cx - radius) / BLADE_STEP), 0, cols - 1);
    const i1 = clamp(Math.floor((cx + radius) / BLADE_STEP), 0, cols - 1);
    const j0 = clamp(Math.floor((cy - radius) / BLADE_STEP), 0, rows - 1);
    const j1 = clamp(Math.floor((cy + radius) / BLADE_STEP), 0, rows - 1);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const b = blades[i * rows + j];
        const dx = b.x - cx, dy = b.y - cy;
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const f = (1 - d / radius) * strength;
        const nx = d > 0 ? dx / d : 0, ny = d > 0 ? dy / d : 0;
        // La hierba se aparta de la pelota y se arrastra en su dirección
        b.vx += (dirX * 0.7 + nx * 0.6) * f;
        b.vy += (dirY * 0.7 + ny * 0.6) * f;
        b.press = Math.max(b.press, 1 - d / radius * 0.6);
        b.fx = dirX; // dirección en la que quedó tumbada
        b.fy = dirY;
      }
    }
  }

  function update(dt) {
    ensureField();
    time += dt;

    if (api.state === 'play') {
      trail.push({ x: ball.x, y: ball.y });
      if (trail.length > 10) trail.shift();
      const sp = Math.hypot(ball.vx, ball.vy) || 1;
      pushGrass(ball.x + BALL_SIZE / 2, ball.y + BALL_SIZE / 2, BALL_GRASS_RADIUS, ball.vx / sp, ball.vy / sp, 900 * dt);
    } else if (trail.length) {
      trail.shift();
    }
    emitFire(dt);

    for (let k = waves.length - 1; k >= 0; k--) {
      const w = waves[k];
      w.t += dt;
      if (w.t > WAVE_LIFE) { waves.splice(k, 1); continue; }
      const r = w.t * WAVE_SPEED;
      const f = 1400 * dt * (1 - w.t / WAVE_LIFE);
      for (const b of blades) {
        const dx = b.x - w.x, dy = b.y - w.y;
        const d = Math.hypot(dx, dy);
        if (d > 0 && Math.abs(d - r) < 5) {
          b.vx += dx / d * f;
          b.vy += dy / d * f;
        }
      }
    }

    for (const b of blades) {
      if (b.press > 0) b.press = Math.max(0, b.press - PRESS_RECOVERY * dt);
      if (!b.bx && !b.by && !b.vx && !b.vy) continue;
      b.vx += (-BLADE_K * b.bx - BLADE_DAMP * b.vx) * dt;
      b.vy += (-BLADE_K * b.by - BLADE_DAMP * b.vy) * dt;
      b.bx = clamp(b.bx + b.vx * dt, -BLADE_MAX, BLADE_MAX);
      b.by = clamp(b.by + b.vy * dt, -BLADE_MAX, BLADE_MAX);
      if (Math.abs(b.bx) < 0.02 && Math.abs(b.by) < 0.02 && Math.abs(b.vx) < 0.1 && Math.abs(b.vy) < 0.1) {
        b.bx = b.by = b.vx = b.vy = 0;
      }
    }

    for (let k = sparks.length - 1; k >= 0; k--) {
      const s = sparks[k];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 1 - 4 * dt;
      s.vy *= 1 - 4 * dt;
      if ((s.life -= dt) <= 0) sparks.splice(k, 1);
    }

    for (let k = confetti.length - 1; k >= 0; k--) {
      const c = confetti[k];
      c.vy = Math.min(c.vy + 260 * dt, 70); // velocidad terminal baja: cae flotando
      c.vx = c.vx * (1 - 1.5 * dt) + Math.sin(time * 3 + c.phase) * 30 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      if ((c.life -= dt) <= 0) confetti.splice(k, 1);
    }

    for (let k = flashes.length - 1; k >= 0; k--) {
      if ((flashes[k].t += dt) > FLASH_LIFE) flashes.splice(k, 1);
    }

    paddleFlash.left = Math.max(0, paddleFlash.left - dt);
    paddleFlash.right = Math.max(0, paddleFlash.right - dt);
    shake = Math.max(0, shake - dt);
  }

  // --- Dibujo ---
  function drawPaddle(p, colors, flash) {
    const rect = api.rect;
    const h = Math.round(p.h);
    // Parpadea cuando a un cambio de tamaño le quedan menos de 2 s
    const ending = [p.giant, p.mini].some((t) => t > 0 && t < 2);
    if (ending && Math.floor(time * 8) % 2) ctx.globalAlpha = 0.55;
    if (p.frozen > 0) colors = C.ice;
    const [light, base, dark] = flash > 0 ? ['#ffffff', '#ffffff', colors[0]] : colors;
    ctx.fillStyle = C.shadow;
    rect(p.x + 2, p.y + 2, PADDLE_W, h);
    ctx.fillStyle = base;
    rect(p.x, p.y + 1, PADDLE_W, h - 2);
    rect(p.x + 1, p.y, PADDLE_W - 2, 1);
    rect(p.x + 1, p.y + h - 1, PADDLE_W - 2, 1);
    ctx.fillStyle = light;
    rect(p.x, p.y + 1, 1, h - 3);
    ctx.fillStyle = dark;
    rect(p.x + PADDLE_W - 1, p.y + 2, 1, h - 3);
    if (p.frozen > 0) {
      // Escarcha
      ctx.fillStyle = '#ffffff';
      for (let y = 3; y < h - 2; y += 5) rect(p.x + 1 + (y % 2), p.y + y, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  function drawField() {
    const rect = api.rect, H = api.H;

    for (let x = 0, k = 0; x < W; x += 20, k++) {
      ctx.fillStyle = k % 2 ? C.grassB : C.grassA;
      rect(x, 0, Math.min(20, W - x), H);
    }

    for (const f of flashes) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.35 * (1 - f.t / FLASH_LIFE)})`;
      rect(f.concededLeft ? 0 : W / 2, 0, W / 2, H);
    }

    ctx.fillStyle = C.bladeDark;
    for (const b of blades) rect(b.x, b.y, 1, 1);
    ctx.fillStyle = C.bladeLight;
    for (const b of blades) {
      if (b.press > 0.25) continue;
      const sway = Math.sin(time * 1.6 + b.phase + b.x * 0.04) * 0.6; // brisa
      rect(Math.round(b.x + b.lx + b.bx + sway), Math.round(b.y + b.ly + b.by), 1, 1);
    }
    // Hierba aplastada: se tumba en la dirección de la flexión y se ve más clara, dejando un rastro
    ctx.fillStyle = C.bladeFlat;
    for (const b of blades) {
      if (b.press <= 0.25) continue;
      rect(Math.round(b.x + b.fx + b.bx * 0.5), Math.round(b.y + b.fy + b.by * 0.5), 1, 1);
      rect(Math.round(b.x + b.fx * 2.4 + b.bx * 0.5), Math.round(b.y + b.fy * 2.4 + b.by * 0.5), 1, 1);
    }
    ctx.fillStyle = C.bladeTip;
    for (const b of blades) {
      if (!b.tall || b.press > 0.25) continue;
      const sway = Math.sin(time * 1.6 + b.phase + b.x * 0.04) * 1.2;
      rect(Math.round(b.x + 2 * b.lx + 2 * b.bx + sway), Math.round(b.y + 2 * b.ly + 2 * b.by), 1, 1);
    }

    // Líneas de cal
    const cx = Math.floor(W / 2), cy = Math.round(H / 2), box = 34;
    ctx.fillStyle = C.chalk;
    rect(2, 2, W - 4, 1);
    rect(2, H - 3, W - 4, 1);
    rect(2, 3, 1, H - 6);
    rect(W - 3, 3, 1, H - 6);
    rect(cx, 3, 1, H - 6);
    for (const [px, py] of circle) rect(cx + px, cy + py, 1, 1);
    rect(cx - 1, cy - 1, 3, 3);
    rect(3, cy - box, 26, 1);
    rect(3, cy + box, 26, 1);
    rect(28, cy - box + 1, 1, box * 2 - 1);
    rect(W - 29, cy - box, 26, 1);
    rect(W - 29, cy + box, 26, 1);
    rect(W - 29, cy - box + 1, 1, box * 2 - 1);
  }

  function drawWaves() {
    const rect = api.rect, H = api.H;
    for (const w of waves) {
      const k = w.t / WAVE_LIFE;
      const rings = [[w.t * WAVE_SPEED, `rgba(255, 255, 255, ${1 - k})`, 2], [w.t * WAVE_SPEED * 0.7, `rgba(255, 230, 120, ${0.8 * (1 - k)})`, 1]];
      for (const [r, color, size] of rings) {
        ctx.fillStyle = color;
        const n = Math.max(24, Math.floor(r * 2 * Math.PI / 2.5));
        for (let i = 0; i < n; i++) {
          const a = i / n * Math.PI * 2;
          const px = Math.round(w.x + Math.cos(a) * r), py = Math.round(w.y + Math.sin(a) * r);
          if (px >= 0 && px < W && py >= 0 && py < H) rect(px, py, size, size);
        }
      }
    }
  }

  function draw() {
    ensureField();
    const { w: sw, h: sh } = api.screenSize();
    const rect = api.rect;

    ctx.fillStyle = C.border;
    ctx.fillRect(0, 0, sw, sh);

    ctx.save();
    if (shake > 0) {
      const a = shake * 10;
      ctx.translate(Math.round(rand(-a, a)), Math.round(rand(-a, a)));
    }

    drawField();
    drawWaves();
    powerups.drawUnder();

    // Marcador con sombra, del color de cada jugador
    const boxes = api.scoreBoxes();
    for (const [side, p, colors] of [['left', left, C.p1], ['right', right, C.p2]]) {
      const b = boxes[side];
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      api.drawNumber(p.score, b.x + 1, b.y + 1, b.s);
      ctx.fillStyle = colors[1];
      api.drawNumber(p.score, b.x, b.y, b.s);
    }

    drawPaddle(left, C.p1, paddleFlash.left);
    drawPaddle(right, C.p2, paddleFlash.right);

    for (let i = 0; i < trail.length; i++) {
      ctx.fillStyle = `rgba(${C.trail}, ${(i + 1) / trail.length * 0.45})`;
      rect(trail[i].x + 1, trail[i].y + 1, 2, 2);
    }

    powerups.drawGhosts();

    // Las llamas van detrás de la pelota; las chispas, delante
    for (const s of sparks) {
      if (!s.fire) continue;
      const k = s.life / s.max;
      ctx.fillStyle = fireColor(k);
      rect(Math.round(s.x), Math.round(s.y), k > 0.5 ? 2 : 1, k > 0.5 ? 2 : 1);
    }

    if (api.ballVisible()) {
      const [body, shade, shine] = BALL_LOOK[burning ? 'fire' : (powerups.slowBall ? 'slow' : 'normal')];
      ctx.fillStyle = C.shadow;
      rect(ball.x + 2, ball.y + 2, BALL_SIZE, BALL_SIZE);
      ctx.fillStyle = body;
      rect(ball.x + 1, ball.y, 2, 4);
      rect(ball.x, ball.y + 1, 4, 2);
      ctx.fillStyle = shade;
      rect(ball.x + 3, ball.y + 2, 1, 1);
      rect(ball.x + 2, ball.y + 3, 1, 1);
      ctx.fillStyle = shine;
      rect(ball.x + 1, ball.y + 1, 1, 1);
    }

    for (const s of sparks) {
      if (s.fire) continue;
      ctx.globalAlpha = Math.min(1, s.life / s.max * 1.5);
      ctx.fillStyle = s.color;
      rect(Math.round(s.x), Math.round(s.y), 1, 1);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Confeti encima de todo; alterna 2x1 / 1x2 para simular que gira en el aire
    for (const c of confetti) {
      const wide = Math.sin(time * c.spin + c.phase) > 0;
      ctx.globalAlpha = Math.min(1, c.life);
      ctx.fillStyle = c.color;
      ctx.fillRect(Math.round(c.x), Math.round(c.y), wide ? 2 : 1, wide ? 1 : 2);
    }
    ctx.globalAlpha = 1;
  }

  return { reset, update, draw, onHit, onWall, onGoal, onWin, burst, shake: addShake };
};
