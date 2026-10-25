// Modo moderno: pixel art a color sobre césped que reacciona a la pelota,
// chispas, estela, fuego, confeti y onda expansiva en los goles, y la pista de hielo.
// game.js crea la instancia pasándole su estado (api) y llama a los eventos on*.
window.PongModern = (api) => {
  'use strict';

  const { ctx, W, PADDLE_W, BALL_SIZE, BALL_MAX_SPEED, left, right, ball, powerups } = api;
  const sfx = () => api.sfx();

  const C = {
    border: '#235a21',
    grassA: '#3f9a3c', grassB: '#48a744',
    bladeDark: '#2f7a2d', bladeLight: '#74c94f', bladeTip: '#a6e86b', bladeFlat: '#b8ec84',
    chalk: 'rgba(240, 255, 230, 0.7)',
    shadow: 'rgba(15, 50, 15, 0.4)',
    trail: '255, 240, 170',
    p1: ['#a8dcff', '#3fa7ff', '#1d5fa8'], // claro, base, oscuro
    p2: ['#ffb8ad', '#ff5a4f', '#a8261f'],
    ice: ['#f0fcff', '#9fe6ff', '#4aa8d8'],
    glow: '255, 228, 107', // brillo dorado de la ayuda por ir perdiendo
  };
  // Pista de hielo (hockey)
  const RINK = {
    border: '#5d7d90', iceA: '#e4f5fc', iceB: '#d8eff9', scratch: '#c2e0ee', sparkle: '#ffffff',
    red: '#e04848', blue: '#3a6fd8', crease: 'rgba(110, 170, 255, 0.45)', boards: '#ffffff',
    shadow: 'rgba(40, 80, 110, 0.3)', trail: '200, 230, 255',
  };
  // Cancha de volcán (piso 3 del RogueLike)
  const LAVA = {
    border: '#1a100d', rockA: '#2b1f1c', rockB: '#33241f', speck: '#45322b', dark: '#1c1412',
    glow: '255, 90, 30', core: '#ff7a1f', hot: '#ffd23f', lines: 'rgba(255, 190, 140, 0.35)',
    shadow: 'rgba(0, 0, 0, 0.45)', trail: '255, 200, 150',
    embers: ['#ffb42e', '#ff5a1f', '#ffd23f'],
  };
  // Pelota según su estado: [cuerpo, sombra, brillo]
  const BALL_LOOK = {
    normal: ['#fff8dc', '#d6c48a', '#ffffff'],
    fire: ['#ffe066', '#ff6a1f', '#ffffff'],
    slow: ['#b8f0ff', '#4aa8d8', '#ffffff'],
    puck: ['#2a2d34', '#111317', '#7a8090'], // sobre el hielo la pelota es un disco de hockey
  };
  const FIRE_SPEED = 215; // a partir de esta velocidad la pelota arde (el RogueLike puede bajarlo)
  const fireSpeed = () => (api.fireSpeed && api.fireSpeed()) || FIRE_SPEED;
  const CONFETTI = ['#ff5a4f', '#ffd23f', '#3fa7ff', '#7ee05a', '#ff8fd8', '#ffffff', '#b07cff'];

  // Resorte blando: la hierba tarda ~1 s en volver a su sitio tras pasar la pelota
  const BLADE_STEP = 6, BLADE_MAX = 3, BLADE_K = 28, BLADE_DAMP = 4.5;
  const BALL_GRASS_RADIUS = 11;
  const PRESS_RECOVERY = 0.55; // por segundo: rastro de hierba aplastada que se desvanece
  const BURN_RADIUS = 130, BURN_RECOVERY = 0.2; // césped quemado tras un gol de fuego (~5 s)
  const WAVE_SPEED = 260, WAVE_LIFE = 0.9;
  const FLASH_LIFE = 0.45;
  const CENTER_RADIUS = 22;
  const ICE_GOALS = 2, ICE_TRANSITION = 1.6; // la pista de hielo dura 2 goles

  let blades = [], cols = 0, rows = 0, fieldH = 0;
  let circle = [], faceoffCircle = [], iceMarks = [], lavaCracks = [];
  const sparks = [];   // coordenadas de campo
  const confetti = []; // coordenadas de pantalla: la gravedad siempre cae hacia abajo, gire o no el móvil
  const waves = [];
  const flashes = [];
  const trail = [];
  const skates = [];   // marcas de la pelota sobre el hielo
  const scorches = []; // manchas de quemado
  const heartFx = [];  // corazones del RogueLike que explotan o arden
  const hudBits = [];  // sus partículas (coordenadas de pantalla)
  const paddleFlash = { left: 0, right: 0 };
  // t: 0 = césped, 1 = hielo; permanent = cancha de hielo fija (piso 2 del RogueLike)
  const ice = { on: false, t: 0, goalsLeft: 0, permanent: false };
  let theme = 'grass'; // grass | lava (el hielo va encima de cualquiera de los dos)
  let shake = 0, shakePower = 1, time = 0;
  let burning = false;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function circlePoints(r) {
    const seen = new Set(), points = [];
    for (let a = 0; a < 360; a += 1.5) {
      const px = Math.round(Math.cos(a * Math.PI / 180) * r);
      const py = Math.round(Math.sin(a * Math.PI / 180) * r);
      if (!seen.has(`${px},${py}`)) {
        seen.add(`${px},${py}`);
        points.push([px, py]);
      }
    }
    return points;
  }

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
          burn: 0, // 1 = carbonizada
          phase: rand(0, Math.PI * 2),
          tall: Math.random() < 0.3,
        });
      }
    }
    circle = circlePoints(CENTER_RADIUS);
    faceoffCircle = circlePoints(12);
    // Arañazos y brillos de la superficie del hielo
    iceMarks = [];
    for (let i = 0; i < 160; i++) {
      iceMarks.push({ x: Math.floor(rand(3, W - 8)), y: Math.floor(rand(3, H - 3)), w: Math.floor(rand(2, 7)), sparkle: Math.random() < 0.25, phase: rand(0, 6) });
    }
    // Grietas de lava: caminos aleatorios que se tuercen poco a poco
    lavaCracks = [];
    for (let i = 0; i < 16; i++) {
      let x = rand(6, W - 6), y = rand(6, H - 6), dir = rand(0, Math.PI * 2);
      const seen = new Set(), points = [];
      for (let step = 0, len = Math.floor(rand(10, 26)); step < len; step++) {
        x += Math.cos(dir) * 1.5;
        y += Math.sin(dir) * 1.5;
        dir += rand(-0.5, 0.5);
        if (x < 4 || x > W - 4 || y < 4 || y > H - 4) break;
        const key = `${Math.round(x)},${Math.round(y)}`;
        if (!seen.has(key)) {
          seen.add(key);
          points.push([Math.round(x), Math.round(y)]);
        }
      }
      if (points.length) lavaCracks.push({ points, phase: rand(0, 6) });
    }
  }

  function ensureField() {
    if (fieldH !== api.H) buildField();
  }

  function reset() {
    ensureField();
    sparks.length = confetti.length = waves.length = flashes.length = trail.length = skates.length = scorches.length = 0;
    heartFx.length = hudBits.length = 0;
    paddleFlash.left = paddleFlash.right = 0;
    shake = 0;
    burning = false;
    ice.on = false;
    ice.t = 0;
    ice.goalsLeft = 0;
    ice.permanent = false;
    theme = 'grass';
    for (const b of blades) b.bx = b.by = b.vx = b.vy = b.press = b.burn = 0;
  }

  // Cancha del piso del RogueLike: 'grass', 'ice' (hielo fijo) o 'lava'. instant = sin animar el hielo.
  function setTheme(name, instant = false) {
    theme = name === 'lava' ? 'lava' : 'grass';
    ice.permanent = name === 'ice';
    ice.on = ice.permanent;
    ice.goalsLeft = 0;
    if (instant) ice.t = ice.on ? 1 : 0;
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
    const color = ice.t > 0.5 ? '#ffffff' : C.bladeTip; // en el hielo salta escarcha
    for (let i = 0; i < 6; i++) {
      sparks.push({ x: ball.x + BALL_SIZE / 2, y: top ? 1 : api.H - 2, vx: rand(-50, 50) + ball.vx * 0.2,
        vy: (top ? 1 : -1) * rand(20, 60), life: rand(0.2, 0.35), max: 0.35, color });
    }
  }

  function onGoal(scorer, y) {
    const concededLeft = scorer === 'right';
    const gx = concededLeft ? 0 : W;
    const fiery = burning; // gol con la pelota en llamas: versión dramática
    waves.push({ x: gx, y, t: 0, fire: fiery });
    flashes.push({ concededLeft, t: 0, fire: fiery });
    burstConfetti(scorer, fiery ? 150 : 90);
    if (fiery) {
      shake = 1.1;
      shakePower = 2.2;
      waves.push({ x: gx, y, t: -0.15, fire: true }); // segunda onda, un poco después
      burst(concededLeft ? 2 : W - 2, y, ['#fff3b0', '#ffb42e', '#ff5a1f', '#ff5a1f'], 60, 220);
      scorch(gx, y);
      sfx().fireGoal();
    } else {
      shake = 0.35;
      shakePower = 1;
    }
    burning = false;
    if (ice.on && !ice.permanent && --ice.goalsLeft <= 0) {
      ice.on = false; // vuelve el césped
      sfx().thaw();
    }
    return fiery;
  }

  function onWin(side) {
    burstConfetti(side, 160);
  }

  function startIce() {
    if (ice.permanent) return; // ya es una pista de hielo
    ice.on = true;
    ice.goalsLeft = ICE_GOALS;
  }

  // Quema el césped alrededor del punto del gol (más cuanto más cerca)
  function scorch(gx, gy) {
    for (const b of blades) {
      const d = Math.hypot(b.x - gx, b.y - gy);
      if (d < BURN_RADIUS) b.burn = Math.max(b.burn, clamp(1.25 - d / BURN_RADIUS + rand(-0.25, 0.25), 0, 1));
    }
    scorches.push({ x: gx, y: gy, life: 1 });
  }

  function burstConfetti(side, n, colors = CONFETTI) {
    const box = api.scoreBoxes()[side];
    if (!box) return; // en Supervivencia la COM no tiene marcador
    const score = side === 'left' ? left.score : right.score;
    const x = box.x + api.numberWidth(score, box.s) / 2;
    const y = box.y + box.s * 2.5;
    for (let i = 0; i < n; i++) {
      confetti.push({ x, y, vx: rand(-100, 100), vy: rand(-190, -40), life: rand(1.6, 2.8),
        color: pick(colors), spin: rand(6, 14), phase: rand(0, 6) });
    }
  }

  // Nuevo récord: lluvia de confeti dorado y destello en toda la cancha
  function celebrate(side) {
    burstConfetti(side, 180, ['#ffd23f', '#fff3b0', '#ffffff', '#ffb42e']);
    flashes.push({ concededLeft: true, t: 0, gold: true }, { concededLeft: false, t: 0, gold: true });
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
    shakePower = 1;
  }

  // Fuego: llamas que salen de la pelota hacia atrás y se apagan en humo
  function emitFire(dt) {
    const speed = Math.hypot(ball.vx, ball.vy);
    const threshold = fireSpeed();
    const hot = api.state === 'play' && speed >= threshold && !powerups.slowBall;
    if (hot && !burning) {
      sfx().ignite();
      burst(ball.x + BALL_SIZE / 2, ball.y + BALL_SIZE / 2, ['#ffe066', '#ff6a1f'], 14, 70);
    }
    if (api.state === 'play') burning = hot; // al marcar se conserva para el gol de fuego
    if (!hot) return;
    const intensity = clamp((speed - threshold) / (BALL_MAX_SPEED - threshold), 0, 1);
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
    ice.t = clamp(ice.t + (ice.on ? 1 : -1) * dt / ICE_TRANSITION * 2, 0, 1);

    if (api.state === 'play') {
      trail.push({ x: ball.x, y: ball.y });
      if (trail.length > 10) trail.shift();
      const sp = Math.hypot(ball.vx, ball.vy) || 1;
      pushGrass(ball.x + BALL_SIZE / 2, ball.y + BALL_SIZE / 2, BALL_GRASS_RADIUS, ball.vx / sp, ball.vy / sp, 900 * dt);
      if (ice.t > 0.5) skates.push({ x: ball.x + BALL_SIZE / 2, y: ball.y + BALL_SIZE / 2, life: 1.5 });
    } else if (trail.length) {
      trail.shift();
    }
    emitFire(dt);

    // Volcán: brasas que saltan de las grietas
    if (theme === 'lava' && ice.t < 1 && lavaCracks.length && Math.random() < 8 * dt) {
      const [x, y] = pick(pick(lavaCracks).points);
      sparks.push({ x, y, vx: rand(-12, 12), vy: rand(-12, 12), life: rand(0.6, 1.2), max: 1.2, color: pick(LAVA.embers) });
    }

    for (let k = waves.length - 1; k >= 0; k--) {
      const w = waves[k];
      w.t += dt;
      if (w.t > WAVE_LIFE) { waves.splice(k, 1); continue; }
      if (w.t < 0) continue;
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

    let smoke = 0;
    for (const b of blades) {
      if (b.press > 0) b.press = Math.max(0, b.press - PRESS_RECOVERY * dt);
      if (b.burn > 0) {
        b.burn = Math.max(0, b.burn - BURN_RECOVERY * dt);
        // Humo que sale del césped quemado
        if (b.burn > 0.55 && smoke < 4 && Math.random() < 1.5 * dt) {
          smoke++;
          sparks.push({ x: b.x, y: b.y, vx: rand(-8, 8), vy: rand(-8, 8), life: rand(0.5, 1), max: 1, color: 'rgba(60, 55, 50, 0.6)' });
        }
      }
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

    for (let k = heartFx.length - 1; k >= 0; k--) {
      if ((heartFx[k].t += dt) > HEART_FX_TIME) heartFx.splice(k, 1);
    }
    for (let k = hudBits.length - 1; k >= 0; k--) {
      const b = hudBits[k];
      b.vy += b.g * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if ((b.life -= dt) <= 0) hudBits.splice(k, 1);
    }

    for (const list of [skates, scorches]) {
      for (let k = list.length - 1; k >= 0; k--) {
        list[k].life -= dt * (list === scorches ? BURN_RECOVERY : 1);
        if (list[k].life <= 0) list.splice(k, 1);
      }
    }
    for (let k = flashes.length - 1; k >= 0; k--) {
      if ((flashes[k].t += dt) > FLASH_LIFE * (flashes[k].fire ? 2 : 1)) flashes.splice(k, 1);
    }

    paddleFlash.left = Math.max(0, paddleFlash.left - dt);
    paddleFlash.right = Math.max(0, paddleFlash.right - dt);
    shake = Math.max(0, shake - dt);
  }

  // --- Dibujo ---
  function drawPaddle(p, colors, flash) {
    const rect = api.rect;
    const h = Math.round(p.h);
    if (p.boost) {
      // Ayuda por ir perdiendo: aura dorada que late y destellos que recorren la paleta
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      ctx.fillStyle = `rgba(${C.glow}, ${0.18 + 0.2 * pulse})`;
      rect(p.x - 3, p.y - 3, PADDLE_W + 6, h + 6);
      ctx.fillStyle = `rgba(${C.glow}, ${0.35 + 0.35 * pulse})`;
      rect(p.x - 1, p.y - 1, PADDLE_W + 2, h + 2);
    }
    // Parpadea cuando a un cambio de tamaño de power-up le quedan menos de 2 s
    const ending = [p.giant, p.mini].some((t) => t > 0 && t < 2);
    if (ending && Math.floor(time * 8) % 2) ctx.globalAlpha = 0.55;
    if (p.frozen > 0) colors = C.ice;
    const [light, base, dark] = flash > 0 ? ['#ffffff', '#ffffff', colors[0]] : colors;
    if (!p.boost) {
      ctx.fillStyle = groundShadow();
      rect(p.x + 2, p.y + 2, PADDLE_W, h);
    }
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
    if (p.boost) {
      ctx.fillStyle = '#fffbe0';
      for (let i = 0; i < 2; i++) {
        const y = ((time * 40 + i * h / 2) % h);
        rect(p.x + (i ? PADDLE_W : -1), p.y + y, 1, 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  // RogueLike: cada piso y cada jefe tiene su propia paleta rival (forma, no solo color)
  function drawEnemyPaddle(p, info, flash) {
    const rect = api.rect;
    const h = Math.round(p.h), x = p.x, y = p.y, w = PADDLE_W;
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    ctx.fillStyle = groundShadow();
    rect(x + 2, y + 2, w, h);
    if (info.elite || info.boss) {
      const rage = info.boss && info.boss.rage;
      ctx.fillStyle = rage ? `rgba(255, 70, 40, ${0.25 + 0.25 * pulse})` : `rgba(255, 210, 63, ${0.15 + 0.15 * pulse})`;
      rect(x - 2, y - 2, w + 4, h + 4);
    }
    const px = (dx, dy, pw, ph, color) => {
      ctx.fillStyle = color;
      rect(x + dx, y + dy, pw, ph);
    };
    switch (info.look) {
      case 'grass': // tablón de madera con clavos y musgo
        px(0, 0, w, h, '#7a4a22');
        px(0, 0, 1, h, '#a0662f');
        px(w - 1, 0, 1, h, '#5a3416');
        for (let j = 4; j < h - 1; j += 6) px(1, j, 2, 1, '#5a3416');
        px(1, 1, 1, 1, '#c8d0d8');
        px(2, h - 2, 1, 1, '#c8d0d8');
        px(-1, 0, 2, 2, '#4caf3a');
        px(-1, Math.floor(h / 2), 1, 2, '#6cc24a');
        px(w - 1, h - 2, 2, 2, '#4caf3a');
        break;
      case 'ice': // cristal facetado con púas
        px(0, 0, w, h, '#5fb8e8');
        for (let j = 0; j < h - 1; j += 4) px(j % 8 ? 2 : 0, j, 2, 2, '#c8f0ff');
        for (let j = 2; j < h - 1; j += 5) px(-1, j, 1, 2, '#e6f8ff');
        px(1, -1, 2, 1, '#e6f8ff');
        px(1, h, 2, 1, '#e6f8ff');
        break;
      case 'lava': { // obsidiana con una grieta de magma que late
        px(0, 0, w, h, '#1c1412');
        px(0, 0, 1, h, '#3d2b25');
        const hot = pulse > 0.6 ? LAVA.hot : LAVA.core;
        for (let j = 1; j < h - 1; j++) px(1 + (Math.floor(j / 3) % 2), j, 1, 1, hot);
        for (let j = 3; j < h - 2; j += 6) px(-1, j, 1, 2, '#2b1f1c');
        break;
      }
      case 'wall': // EL MURO: ladrillos con argamasa, más ancho que su paleta
        px(-1, 0, w + 2, h, '#8a8070');
        for (let j = 0, row = 0; j < h; j += 3, row++) {
          const color = row % 2 ? '#a02a22' : '#b8322a';
          const bh = Math.min(2, h - j);
          if (row % 2) {
            px(-1, j, 1, bh, color);
            px(1, j, 4, bh, color);
          } else {
            px(-1, j, 3, bh, color);
            px(3, j, 2, bh, color);
          }
        }
        break;
      case 'iceking': // REY DE HIELO: cristal con corona en los extremos y un ojo que brilla
        px(0, 0, w, h, '#3a8fd0');
        for (let j = 1; j < h - 1; j += 3) px(j % 6 ? 2 : 0, j, 2, 2, '#c8f0ff');
        for (const [dy, dir] of [[0, -1], [h, 1]]) {
          px(-1, dy + (dir < 0 ? -2 : 0), 1, 2, '#e6f8ff');
          px(1, dy + (dir < 0 ? -3 : 0), 2, 3, '#ffffff');
          px(4, dy + (dir < 0 ? -2 : 0), 1, 2, '#e6f8ff');
        }
        px(1, Math.floor(h / 2) - 1, 2, 2, pulse > 0.5 ? '#ffffff' : '#1d5fa8');
        break;
      case 'dragon': { // DRAGÓN: escamas, vientre dorado, cuernos y ojos
        px(0, 0, w, h, '#7a1a14');
        for (let j = 0; j < h; j += 3) px(Math.floor(j / 3) % 2, j, 2, 1, '#b8322a');
        px(w - 1, 2, 1, h - 4, '#e8b83a');
        px(-1, -2, 1, 2, '#e8dcc0');
        px(-2, -3, 1, 1, '#e8dcc0');
        px(-1, h, 1, 2, '#e8dcc0');
        px(-2, h + 2, 1, 1, '#e8dcc0');
        const eye = info.boss && info.boss.rage ? '#ff3a2a' : '#ffd23f';
        px(0, Math.floor(h / 2) - 3, 1, 1, eye);
        px(0, Math.floor(h / 2) + 2, 1, 1, eye);
        break;
      }
    }
    if (p.frozen > 0) {
      px(0, 0, w, h, 'rgba(159, 230, 255, 0.55)');
      for (let j = 3; j < h - 2; j += 5) px(1 + (j % 2), j, 1, 1, '#ffffff');
    }
    if (flash > 0) px(0, 0, w, h, 'rgba(255, 255, 255, 0.7)');
  }

  function drawField() {
    const rect = api.rect, H = api.H;

    for (let x = 0, k = 0; x < W; x += 20, k++) {
      ctx.fillStyle = k % 2 ? C.grassB : C.grassA;
      rect(x, 0, Math.min(20, W - x), H);
    }

    // Mancha de quemado bajo las briznas
    for (const s of scorches) {
      const r = BURN_RADIUS * 0.75;
      ctx.fillStyle = `rgba(45, 30, 12, ${0.4 * Math.min(1, s.life * 1.5)})`;
      for (let dy = -r; dy <= r; dy += 2) {
        const w = Math.sqrt(r * r - dy * dy) * (0.85 + 0.15 * Math.sin(dy * 0.7));
        const y = s.y + dy;
        if (y < 0 || y >= H) continue;
        const x0 = clamp(s.x - w, 0, W), x1 = clamp(s.x + w, 0, W);
        rect(x0, y, x1 - x0, 2);
      }
    }

    for (const f of flashes) {
      const k = f.t / (FLASH_LIFE * (f.fire ? 2 : 1));
      const rgb = f.fire ? '255, 120, 30' : (f.gold ? '255, 210, 63' : '255, 255, 255');
      ctx.fillStyle = `rgba(${rgb}, ${(f.fire ? 0.5 : 0.35) * (1 - k)})`;
      rect(f.concededLeft ? 0 : W / 2, 0, W / 2, H);
    }

    ctx.fillStyle = C.bladeDark;
    for (const b of blades) if (b.burn <= 0.15) rect(b.x, b.y, 1, 1);
    ctx.fillStyle = C.bladeLight;
    for (const b of blades) {
      if (b.press > 0.25 || b.burn > 0.15) continue;
      const sway = Math.sin(time * 1.6 + b.phase + b.x * 0.04) * 0.6; // brisa
      rect(Math.round(b.x + b.lx + b.bx + sway), Math.round(b.y + b.ly + b.by), 1, 1);
    }
    // Hierba aplastada: se tumba en la dirección de la flexión y se ve más clara, dejando un rastro
    ctx.fillStyle = C.bladeFlat;
    for (const b of blades) {
      if (b.press <= 0.25 || b.burn > 0.15) continue;
      rect(Math.round(b.x + b.fx + b.bx * 0.5), Math.round(b.y + b.fy + b.by * 0.5), 1, 1);
      rect(Math.round(b.x + b.fx * 2.4 + b.bx * 0.5), Math.round(b.y + b.fy * 2.4 + b.by * 0.5), 1, 1);
    }
    ctx.fillStyle = C.bladeTip;
    for (const b of blades) {
      if (!b.tall || b.press > 0.25 || b.burn > 0.15) continue;
      const sway = Math.sin(time * 1.6 + b.phase + b.x * 0.04) * 1.2;
      rect(Math.round(b.x + 2 * b.lx + 2 * b.bx + sway), Math.round(b.y + 2 * b.ly + 2 * b.by), 1, 1);
    }
    // Hierba quemada: amarillenta, marrón o carbonizada, con brasas en la más quemada
    for (const b of blades) {
      if (b.burn <= 0.15) continue;
      ctx.fillStyle = b.burn > 0.6 ? '#2b2116' : (b.burn > 0.35 ? '#5a4426' : '#8a7a3a');
      rect(b.x, b.y, 1, 1);
      rect(Math.round(b.x + b.lx), Math.round(b.y + b.ly), 1, 1);
      if (b.burn > 0.6 && Math.sin(time * 9 + b.phase * 7) > 0.7) {
        ctx.fillStyle = Math.sin(time * 5 + b.phase) > 0 ? '#ff7a1f' : '#ffb42e';
        rect(Math.round(b.x + b.lx), Math.round(b.y + b.ly), 1, 1);
      }
    }

    drawCourtLines(C.chalk);
  }

  // Líneas de la cancha (cal en el césped, marcas tenues en el volcán)
  function drawCourtLines(color) {
    const rect = api.rect, H = api.H;
    const cx = Math.floor(W / 2), cy = Math.round(H / 2), box = 34;
    ctx.fillStyle = color;
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

  function drawRink() {
    const rect = api.rect, H = api.H;
    const cx = Math.floor(W / 2), cy = Math.round(H / 2);

    for (let x = 0, k = 0; x < W; x += 20, k++) {
      ctx.fillStyle = k % 2 ? RINK.iceB : RINK.iceA;
      rect(x, 0, Math.min(20, W - x), H);
    }
    for (const m of iceMarks) {
      if (m.y >= H) continue;
      if (m.sparkle) {
        if (Math.sin(time * 2 + m.phase) > 0.6) {
          ctx.fillStyle = RINK.sparkle;
          rect(m.x, m.y, 1, 1);
        }
      } else {
        ctx.fillStyle = RINK.scratch;
        rect(m.x, m.y, m.w, 1);
      }
    }
    // Marcas que deja el disco al deslizarse
    for (const s of skates) {
      ctx.fillStyle = `rgba(150, 195, 220, ${0.5 * s.life / 1.5})`;
      rect(Math.round(s.x), Math.round(s.y), 1, 1);
    }

    // Áreas de portería (semicírculos azules) y líneas de gol
    ctx.fillStyle = RINK.crease;
    for (let dy = -16; dy <= 16; dy++) {
      const w = Math.round(Math.sqrt(256 - dy * dy));
      rect(22, cy + dy, w, 1);
      rect(W - 22 - w, cy + dy, w, 1);
    }
    ctx.fillStyle = RINK.red;
    rect(22, 3, 1, H - 6);
    rect(W - 23, 3, 1, H - 6);
    rect(cx - 1, 3, 2, H - 6); // línea roja central
    // Círculos de saque rojos
    const fy = Math.round(H * 0.27);
    for (const [fx, fyy] of [[52, cy - fy], [52, cy + fy], [W - 52, cy - fy], [W - 52, cy + fy]]) {
      for (const [px, py] of faceoffCircle) rect(fx + px, fyy + py, 1, 1);
      rect(fx - 1, fyy - 1, 2, 2);
    }
    // Líneas azules y círculo central
    ctx.fillStyle = RINK.blue;
    rect(cx - 56, 3, 3, H - 6);
    rect(cx + 53, 3, 3, H - 6);
    for (const [px, py] of circle) rect(cx + px, cy + py, 1, 1);
    rect(cx - 1, cy - 1, 3, 3);
    // Vallas
    ctx.fillStyle = RINK.boards;
    rect(1, 1, W - 2, 2);
    rect(1, H - 3, W - 2, 2);
    rect(1, 3, 2, H - 6);
    rect(W - 3, 3, 2, H - 6);
  }

  // Corazón de 7x6 píxeles
  const HEART = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
  const HEART_FX_TIME = 0.6;

  function drawHeart(x, y, full, color = null) {
    ctx.fillStyle = color || (full ? '#ff4d5e' : 'rgba(60, 20, 28, 0.75)');
    HEART.forEach((row, j) => {
      for (let i = 0; i < 7; i++) if (row[i] === '1') ctx.fillRect(x + i, y + j, 1, 1);
    });
    if (full && !color) {
      ctx.fillStyle = '#ffd6dc';
      ctx.fillRect(x + 1, y + 1, 1, 1);
    }
  }

  // Corazón perdido: estalla en pedazos; si fue un gol de fuego, arde y se deshace en brasas y humo
  function heartLost(index, fire) {
    heartFx.push({ index, fire, t: 0, burst: false });
  }

  function drawHeartFx(fx, x, y) {
    const k = fx.t / HEART_FX_TIME;
    if (fx.fire) {
      // Parpadea entre amarillo, naranja y rojo mientras se consume
      const colors = ['#fff3b0', '#ffb42e', '#ff5a1f', '#a8261f'];
      if (k < 0.8) drawHeart(x + Math.round(rand(-1, 1)), y, true, colors[Math.floor(time * 20) % 3 + (k > 0.5 ? 1 : 0)]);
      if (Math.random() < 0.7) {
        hudBits.push({ x: x + rand(0, 7), y: y + rand(0, 4), vx: rand(-8, 8), vy: rand(-45, -20), g: -10,
          life: rand(0.3, 0.6), max: 0.6, color: pick(['#ffd23f', '#ff7a1f', '#ff5a1f']) });
      }
      if (!fx.burst && k > 0.75) {
        fx.burst = true;
        for (let i = 0; i < 12; i++) {
          hudBits.push({ x: x + rand(0, 7), y: y + rand(0, 6), vx: rand(-10, 10), vy: rand(-30, -8), g: -6,
            life: rand(0.6, 1.1), max: 1.1, color: 'rgba(70, 60, 55, 0.8)' });
        }
      }
    } else {
      // Destello blanco que crece y luego estalla en trozos rojos que caen
      if (k < 0.3) {
        const grow = Math.round(k * 6);
        drawHeart(x - grow / 2, y - grow / 2, true, '#ffffff');
      }
      if (!fx.burst && k >= 0.3) {
        fx.burst = true;
        for (let i = 0; i < 18; i++) {
          const a = rand(0, Math.PI * 2), sp = rand(25, 70);
          hudBits.push({ x: x + 3, y: y + 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, g: 140,
            life: rand(0.5, 0.9), max: 0.9, color: pick(['#ff4d5e', '#ffb3bc', '#a8263a', '#ffffff']) });
        }
      }
    }
  }

  // RogueLike: corazones, goles de la sala (pips) y barra de vida del jefe
  function drawRogueHud(boxes, info) {
    for (let i = 0; i < info.maxHearts; i++) {
      const fx = heartFx.find((f) => f.index === i);
      const x = boxes.hearts.x + i * 8, y = boxes.hearts.y;
      if (fx) {
        drawHeart(x, y, false);
        drawHeartFx(fx, x, y);
      } else {
        drawHeart(x, y, i < info.hearts);
      }
    }
    for (const b of hudBits) {
      ctx.globalAlpha = Math.min(1, b.life / b.max * 1.5);
      ctx.fillStyle = b.color;
      ctx.fillRect(Math.round(b.x), Math.round(b.y), 1, 1);
    }
    ctx.globalAlpha = 1;

    for (let i = 0; i < info.target; i++) {
      const x = boxes.pips.x + i * 6, y = boxes.pips.y;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(x + 1, y + 1, 4, 4);
      ctx.fillStyle = i < info.goals ? '#ffd23f' : 'rgba(255, 255, 255, 0.35)';
      ctx.fillRect(x, y, 4, 4);
    }

    if (info.boss) {
      const { x, y, w } = boxes.boss;
      const fillW = Math.round(w * info.boss.left / info.boss.max);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(x - 1, y - 1, w + 2, 6);
      const blink = info.boss.rage && Math.floor(time * 6) % 2;
      ctx.fillStyle = info.boss.rage ? (blink ? '#ff5a4f' : '#ffb42e') : '#b07cff';
      ctx.fillRect(x, y, fillW, 4);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillRect(x, y, fillW, 1);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'; // separadores: un tramo por golpe de vida
      for (let i = 1; i < info.boss.max; i++) ctx.fillRect(x + Math.round(w * i / info.boss.max), y, 1, 4);
    }
  }

  function drawWaves() {
    const rect = api.rect, H = api.H;
    for (const w of waves) {
      if (w.t < 0) continue;
      const k = w.t / WAVE_LIFE;
      const rings = w.fire
        ? [[w.t * WAVE_SPEED, `rgba(255, 180, 50, ${1 - k})`, 3], [w.t * WAVE_SPEED * 0.75, `rgba(255, 70, 20, ${0.9 * (1 - k)})`, 2]]
        : [[w.t * WAVE_SPEED, `rgba(255, 255, 255, ${1 - k})`, 2], [w.t * WAVE_SPEED * 0.7, `rgba(255, 230, 120, ${0.8 * (1 - k)})`, 1]];
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

  // Volcán: roca oscura con grietas de lava que laten
  function drawLava() {
    const rect = api.rect, H = api.H;
    for (let x = 0, k = 0; x < W; x += 20, k++) {
      ctx.fillStyle = k % 2 ? LAVA.rockB : LAVA.rockA;
      rect(x, 0, Math.min(20, W - x), H);
    }
    for (const m of iceMarks) {
      if (m.y >= H) continue;
      ctx.fillStyle = m.sparkle ? LAVA.dark : LAVA.speck;
      rect(m.x, m.y, Math.min(m.w, 3), 1);
    }
    for (const c of lavaCracks) {
      const glow = 0.55 + 0.45 * Math.sin(time * 2 + c.phase);
      ctx.fillStyle = `rgba(${LAVA.glow}, ${0.22 * glow})`;
      for (const [x, y] of c.points) if (y < H) rect(x - 1, y - 1, 3, 3);
      ctx.fillStyle = glow > 0.75 ? LAVA.hot : LAVA.core;
      for (const [x, y] of c.points) if (y < H) rect(x, y, 1, 1);
    }
    for (const f of flashes) {
      const k = f.t / (FLASH_LIFE * (f.fire ? 2 : 1));
      ctx.fillStyle = `rgba(255, ${f.gold ? 210 : 120}, 40, ${0.4 * (1 - k)})`;
      rect(f.concededLeft ? 0 : W / 2, 0, W / 2, H);
    }
    drawCourtLines(LAVA.lines);
  }

  const groundShadow = () => (ice.t > 0.5 ? RINK.shadow : (theme === 'lava' ? LAVA.shadow : C.shadow));

  // Fondo: césped o volcán, hielo, o la transición (el hielo se expande desde el centro)
  function drawGround(sw, sh) {
    if (ice.t < 1) {
      if (theme === 'lava') drawLava();
      else drawField();
    }
    if (ice.t <= 0) return;
    ctx.save();
    if (ice.t < 1) {
      ctx.beginPath();
      ctx.arc(sw / 2, sh / 2, ice.t * Math.hypot(sw, sh) / 2, 0, Math.PI * 2);
      ctx.clip();
    }
    drawRink();
    ctx.restore();
  }

  function draw() {
    ensureField();
    const { w: sw, h: sh } = api.screenSize();
    const rect = api.rect;
    const onIce = ice.t > 0.5;

    ctx.fillStyle = onIce ? RINK.border : (theme === 'lava' ? LAVA.border : C.border);
    ctx.fillRect(0, 0, sw, sh);

    ctx.save();
    if (shake > 0) {
      const a = Math.min(shake * 10 * shakePower, 9);
      ctx.translate(Math.round(rand(-a, a)), Math.round(rand(-a, a)));
    }

    drawGround(sw, sh);
    drawWaves();
    powerups.drawUnder();

    // Marcador con sombra, del color de cada jugador (en Supervivencia: solo J1 y el reloj)
    const boxes = api.scoreBoxes();
    for (const [side, p, colors] of [['left', left, C.p1], ['right', right, C.p2]]) {
      const b = boxes[side];
      if (!b) continue;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      api.drawNumber(p.score, b.x + 1, b.y + 1, b.s);
      ctx.fillStyle = colors[1];
      api.drawNumber(p.score, b.x, b.y, b.s);
    }
    const rogue = api.rogue;
    if (rogue) drawRogueHud(boxes, rogue);

    drawPaddle(left, C.p1, paddleFlash.left);
    if (rogue && rogue.look) drawEnemyPaddle(right, rogue, paddleFlash.right);
    else drawPaddle(right, C.p2, paddleFlash.right);

    const trailColor = onIce ? RINK.trail : (theme === 'lava' ? LAVA.trail : C.trail);
    for (let i = 0; i < trail.length; i++) {
      ctx.fillStyle = `rgba(${trailColor}, ${(i + 1) / trail.length * 0.45})`;
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
      const look = burning ? 'fire' : (powerups.slowBall ? 'slow' : (onIce ? 'puck' : 'normal'));
      const [body, shade, shine] = BALL_LOOK[look];
      ctx.fillStyle = groundShadow();
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

  return {
    reset, update, draw, onHit, onWall, onGoal, onWin, burst, startIce, celebrate, setTheme, heartLost,
    shake: addShake,
    get iceActive() { return ice.on; },
  };
};
