// Power-ups del modo moderno: regalos que aparecen en la línea central y, al tocarlos con la
// pelota, dan un efecto a quien la lanzó. También gestiona las bolas fantasma y los globos.
// game.js llama a update/collide/checkShield/adjustHitSpeed; modern.js llama a los draw*.
window.PongPowerups = (api) => {
  'use strict';

  const { W, BALL_SIZE, PADDLE_H, BALL_SPEED, left, right, ball } = api;
  const sfx = () => api.sfx();

  const GIFT = BALL_SIZE * 4; // el regalo mide 4 veces la pelota
  const GIFT_LIFE = 12;
  const MAX_GIFTS = 2;
  const SPAWN_MIN = 6, SPAWN_MAX = 11;
  const GIANT_TIME = 10, MINI_TIME = 8, FREEZE_TIME = 2, SHIELD_TIME = 15;
  const SLOW_FACTOR = 0.4;
  const BALLOON_COUNT = 10, BALLOON_LIFE = 15;
  const RESIZE_SPEED = 60;
  const COMEBACK_GAP = 5, COMEBACK_BOOST = 1.5; // ayuda al que pierde de 5: paleta +50% hasta empatar
  const MAX_SIZE_MULT = 2.5; // tope si se juntan ayuda y Gigante
  const MAX_STEP = 1 / 240;

  const TYPES = [
    { id: 'ghost', name: 'FANTASMAS', weight: 3 },
    { id: 'slow', name: 'PASE LENTO', weight: 2 },
    { id: 'giant', name: 'GIGANTE', weight: 3 },
    { id: 'balloons', name: 'GLOBOS', weight: 2 },
    { id: 'shield', name: 'ESCUDO', weight: 2 },
    { id: 'mini', name: 'MINI RIVAL', weight: 2 },
    { id: 'freeze', name: 'CONGELADO', weight: 1 },
  ];
  // [caja, sombra de la caja, cinta]
  const GIFT_COLORS = [
    ['#ff5a4f', '#b8322a', '#ffd23f'],
    ['#3fa7ff', '#1d5fa8', '#ffffff'],
    ['#b07cff', '#6f45b8', '#7ee05a'],
    ['#ffd23f', '#c99a12', '#ff5a4f'],
    ['#ff8fd8', '#c2559f', '#3fa7ff'],
  ];
  // [base, sombra, brillo]
  const BALLOON_COLORS = [
    ['#ff4d5e', '#b8263a', '#ffb3bc'],
    ['#ffd23f', '#c99a12', '#fff2b0'],
    ['#3fa7ff', '#1d5fa8', '#b8e2ff'],
    ['#b07cff', '#6f45b8', '#e2ccff'],
    ['#ff8fd8', '#c2559f', '#ffd6f1'],
    ['#7ee05a', '#3f9a2c', '#d2f7c0'],
  ];

  const gifts = [];
  const ghosts = [];
  const balloons = [];
  let spawnTimer = 0;
  let slowFor = null;   // lado cuyo próximo golpe saldrá lento
  let slowBall = false; // la pelota va lenta ahora mismo
  let slowSaved = 0;    // velocidad que recupera tras el golpe lento
  let time = 0;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const paddleOf = (side) => (side === 'left' ? left : right);
  const otherSide = (side) => (side === 'left' ? 'right' : 'left');

  function pickType() {
    let r = Math.random() * TYPES.reduce((sum, t) => sum + t.weight, 0);
    for (const t of TYPES) if ((r -= t.weight) < 0) return t;
    return TYPES[0];
  }

  function reset() {
    gifts.length = ghosts.length = balloons.length = 0;
    spawnTimer = rand(4, 7);
    slowFor = null;
    slowBall = false;
    slowSaved = 0;
    for (const p of [left, right]) {
      p.h = PADDLE_H * Math.min(p.sizeMult || 1, MAX_SIZE_MULT);
      p.giant = p.mini = p.frozen = p.shield = 0;
      p.boost = false;
    }
  }

  // Tras cada gol: activa la ayuda a quien pierde de 5 o más y la retira cuando empata
  function checkComeback() {
    for (const [p, rival, side] of [[left, right, 'left'], [right, left, 'right']]) {
      if (!p.boost && rival.score - p.score >= COMEBACK_GAP) {
        p.boost = true;
        api.showMsg(`¡AYUDA PARA ${api.playerName(side)}!`, 1.8);
        api.fx().burst(p.x + 2, p.y + p.h / 2, ['#ffe46b', '#ffffff'], 24, 90);
        sfx().boost();
      } else if (p.boost && p.score >= rival.score) {
        p.boost = false;
      }
    }
  }

  // Tras un gol desaparecen los fantasmas y la pelota deja de ir lenta
  function onGoal() {
    for (const g of ghosts) api.fx().burst(g.x + BALL_SIZE / 2, g.y + BALL_SIZE / 2, ['#9fd4ff', '#ffffff'], 8, 50);
    ghosts.length = 0;
    slowBall = false;
  }

  // --- Aparición de regalos ---
  function spawnGift() {
    const H = api.H;
    for (let tries = 0; tries < 12; tries++) {
      const y = Math.round(rand(6, H - GIFT - 6));
      if (gifts.some((g) => Math.abs(g.y - y) < GIFT + 6)) continue;
      if (Math.abs(ball.y - y) < GIFT && Math.abs(ball.x - W / 2) < GIFT) continue; // no encima de la pelota
      const g = { x: W / 2 - GIFT / 2, y, life: GIFT_LIFE, t: 0, colors: pick(GIFT_COLORS) };
      gifts.push(g);
      api.fx().burst(W / 2, y + GIFT / 2, ['#ffffff', '#ffd23f'], 10, 40);
      sfx().gift();
      return;
    }
  }

  // --- Efectos ---
  function activate(owner, g) {
    const type = pickType();
    const me = paddleOf(owner), rival = paddleOf(otherSide(owner));
    switch (type.id) {
      case 'ghost': spawnGhosts(); break;
      case 'slow': slowFor = otherSide(owner); break;
      case 'giant': me.giant = GIANT_TIME; me.mini = 0; break;
      case 'mini': rival.mini = MINI_TIME; rival.giant = 0; break;
      case 'shield': me.shield = SHIELD_TIME; break;
      case 'freeze':
        rival.frozen = FREEZE_TIME;
        api.fx().startIce();
        break;
      case 'balloons': spawnBalloons(); break;
    }
    api.fx().burst(g.x + GIFT / 2, g.y + GIFT / 2, [...g.colors, '#ffffff'], 30, 110);
    api.showMsg(`${api.playerName(owner)}: ${type.name}`, 1.5);
    sfx().powerup();
    const typeSound = { ghost: 'ghost', slow: 'slow', giant: 'grow', mini: 'shrink', shield: 'shield', freeze: 'freeze', balloons: 'balloons' };
    sfx()[typeSound[type.id]]();
  }

  // Bolas fantasma que salen de la pelota con otro ángulo; fire = fantasmas de fuego (del Dragón)
  function spawnGhosts(count = 2, fire = false) {
    const speed = Math.max(Math.hypot(ball.vx, ball.vy), BALL_SPEED);
    const sign = Math.sign(ball.vx) || 1;
    const base = Math.atan2(ball.vy, Math.abs(ball.vx));
    const offsets = count === 1 ? [pick([-0.5, 0.5])] : [-0.5, 0.5];
    for (const d of offsets) {
      const a = clamp(base + d, -1.05, 1.05);
      ghosts.push({ x: ball.x, y: ball.y, vx: Math.cos(a) * speed * sign, vy: Math.sin(a) * speed, t: rand(0, 6), trail: [], fire });
    }
  }

  function spawnBalloons() {
    const H = api.H;
    let placed = 0;
    for (let tries = 0; tries < 200 && placed < BALLOON_COUNT; tries++) {
      const r = Math.round(rand(5, 8));
      const x = rand(40, W - 40), y = rand(r + 4, H - r - 4);
      if (Math.abs(x - W / 2) < GIFT / 2 + r + 2) continue; // libre la columna de los regalos
      if (balloons.some((b) => Math.hypot(b.x - x, b.y - y) < b.r + r + 6)) continue;
      if (Math.hypot(ball.x - x, ball.y - y) < r + 12) continue;
      balloons.push({ x, y, r, colors: pick(BALLOON_COLORS), life: BALLOON_LIFE, phase: rand(0, 6) });
      placed++;
    }
  }

  function popBalloon(k) {
    const b = balloons[k];
    balloons.splice(k, 1);
    api.fx().burst(b.x, b.y, [b.colors[0], b.colors[2], '#ffffff'], 16, 90);
    sfx().pop();
  }

  // Lo llama game.js en cada golpe de paleta: aplica el "pase lento" (un solo rebote)
  function adjustHitSpeed(side, speed) {
    if (slowFor === side) {
      slowFor = null;
      slowBall = true;
      slowSaved = speed;
      return BALL_SPEED * SLOW_FACTOR;
    }
    if (slowBall) {
      slowBall = false;
      return slowSaved;
    }
    return speed;
  }

  // Escudo: si la pelota va a entrar, rebota una vez en la línea de gol
  function checkShield() {
    const side = ball.vx < 0 && ball.x < 1 ? 'left' : (ball.vx > 0 && ball.x + BALL_SIZE > W - 1 ? 'right' : null);
    if (!side || paddleOf(side).shield <= 0) return;
    paddleOf(side).shield = 0;
    ball.vx = -ball.vx;
    ball.x = side === 'left' ? 1 : W - 1 - BALL_SIZE;
    api.fx().burst(side === 'left' ? 1 : W - 1, ball.y + BALL_SIZE / 2, ['#7fe8ff', '#ffffff'], 24, 120);
    api.fx().shake(0.15);
    sfx().block();
  }

  // Colisiones de la pelota real con regalos y globos (se llama en cada subpaso)
  function collide() {
    for (let k = gifts.length - 1; k >= 0; k--) {
      const g = gifts[k];
      if (ball.x < g.x + GIFT && ball.x + BALL_SIZE > g.x && ball.y < g.y + GIFT && ball.y + BALL_SIZE > g.y) {
        gifts.splice(k, 1);
        activate(ball.vx > 0 ? 'left' : 'right', g);
      }
    }

    const cx = ball.x + BALL_SIZE / 2, cy = ball.y + BALL_SIZE / 2;
    for (let k = balloons.length - 1; k >= 0; k--) {
      const b = balloons[k];
      const dx = cx - b.x, dy = cy - b.y;
      const d = Math.hypot(dx, dy);
      if (d >= b.r + BALL_SIZE / 2) continue;
      const nx = d > 0 ? dx / d : 1, ny = d > 0 ? dy / d : 0;
      const dot = ball.vx * nx + ball.vy * ny;
      if (dot < 0) {
        ball.vx -= 2 * dot * nx;
        ball.vy -= 2 * dot * ny;
      }
      // Que nunca quede rebotando casi en vertical
      const speed = Math.hypot(ball.vx, ball.vy);
      if (Math.abs(ball.vx) < speed * 0.4) {
        ball.vx = Math.sign(ball.vx || nx || 1) * speed * 0.4;
        ball.vy = Math.sign(ball.vy || 1) * Math.sqrt(speed * speed - ball.vx * ball.vx);
      }
      ball.x = b.x + nx * (b.r + BALL_SIZE / 2 + 0.5) - BALL_SIZE / 2;
      ball.y = b.y + ny * (b.r + BALL_SIZE / 2 + 0.5) - BALL_SIZE / 2;
      popBalloon(k);
    }
  }

  // --- Simulación ---
  function stepGhost(g, dt) {
    const H = api.H;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    if (g.y < 0) { g.y = 0; g.vy = Math.abs(g.vy); }
    else if (g.y > H - BALL_SIZE) { g.y = H - BALL_SIZE; g.vy = -Math.abs(g.vy); }
    for (const [p, dir] of [[left, 1], [right, -1]]) {
      if ((dir > 0 ? g.vx < 0 : g.vx > 0) && g.x < p.x + 4 && g.x + BALL_SIZE > p.x && g.y < p.y + p.h && g.y + BALL_SIZE > p.y) {
        const rel = clamp((g.y + BALL_SIZE / 2 - (p.y + p.h / 2)) / (p.h / 2 + BALL_SIZE / 2), -1, 1);
        const speed = Math.hypot(g.vx, g.vy);
        g.vx = Math.cos(rel * Math.PI / 3) * speed * dir;
        g.vy = Math.sin(rel * Math.PI / 3) * speed;
        g.x = dir > 0 ? p.x + 4 : p.x - BALL_SIZE;
      }
    }
  }

  function update(dt) {
    const H = api.H;
    time += dt;

    for (const p of [left, right]) {
      p.giant = Math.max(0, p.giant - dt);
      p.mini = Math.max(0, p.mini - dt);
      p.frozen = Math.max(0, p.frozen - dt);
      p.shield = Math.max(0, p.shield - dt);
      // sizeMult = tamaño base (cartas y rivales del RogueLike); el resto, power-ups y ayuda
      const mult = (p.sizeMult || 1) * (p.giant > 0 ? 2 : 1) * (p.mini > 0 ? 0.5 : 1) * (p.boost ? COMEBACK_BOOST : 1);
      const target = PADDLE_H * Math.min(mult, MAX_SIZE_MULT);
      if (p.h !== target) {
        const old = p.h;
        p.h += clamp(target - p.h, -RESIZE_SPEED * dt, RESIZE_SPEED * dt);
        p.y = clamp(p.y - (p.h - old) / 2, 0, H - p.h); // crece/encoge desde el centro
      }
    }

    if (api.state === 'play') {
      if ((spawnTimer -= dt) <= 0) {
        spawnTimer = rand(SPAWN_MIN, SPAWN_MAX) / (api.giftRate ? api.giftRate() : 1);
        if (gifts.length < MAX_GIFTS) spawnGift();
      }

      for (let k = ghosts.length - 1; k >= 0; k--) {
        const g = ghosts[k];
        g.t += dt;
        g.trail.push({ x: g.x, y: g.y });
        if (g.trail.length > 8) g.trail.shift();
        for (let t = dt; t > 0; t -= MAX_STEP) stepGhost(g, Math.min(t, MAX_STEP));
        // Al cruzar la línea de meta desaparece sin marcar
        if (g.x + BALL_SIZE < 0 || g.x > W) {
          api.fx().burst(clamp(g.x, 0, W), g.y + BALL_SIZE / 2, ['#9fd4ff', '#ffffff'], 10, 60);
          ghosts.splice(k, 1);
        }
      }
    }

    for (let k = gifts.length - 1; k >= 0; k--) {
      const g = gifts[k];
      g.t += dt;
      g.y = Math.min(g.y, H - GIFT - 2);
      if ((g.life -= dt) <= 0) {
        api.fx().burst(g.x + GIFT / 2, g.y + GIFT / 2, ['#ffffff'], 10, 40);
        gifts.splice(k, 1);
      }
    }

    for (let k = balloons.length - 1; k >= 0; k--) {
      const b = balloons[k];
      b.y = Math.min(b.y, H - b.r - 2);
      if ((b.life -= dt) <= 0) popBalloon(k);
    }
  }

  // --- Dibujo ---
  // Regalos y globos se dibujan en coordenadas de pantalla para que siempre se vean derechos
  function drawGift(g) {
    const ctx = api.ctx;
    if (g.life < 2 && Math.floor(g.t * 8) % 2) return; // parpadea antes de desaparecer
    const bob = Math.round(Math.sin(g.t * 3) * 1.2);
    const s = api.toScreenRect(g.x, g.y, GIFT, GIFT);
    const x = Math.round(s.x), y = Math.round(s.y) + bob;
    const [box, dark, ribbon] = g.colors;
    const px = (dx, dy, w, h) => ctx.fillRect(x + dx, y + dy, w, h);

    ctx.fillStyle = 'rgba(15, 50, 15, 0.4)';
    px(2, 6 - bob, 15, 12);
    ctx.fillStyle = dark;
    px(1, 6, 14, 10);
    ctx.fillStyle = box;
    px(1, 6, 12, 9);
    px(0, 3, 16, 3);
    ctx.fillStyle = dark;
    px(0, 6, 16, 1);
    ctx.fillStyle = ribbon;
    px(7, 3, 2, 13);
    px(3, 0, 3, 3); // lazo
    px(10, 0, 3, 3);
    px(6, 1, 4, 2);
    ctx.fillStyle = box;
    px(4, 1, 1, 1);
    px(11, 1, 1, 1);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    px(2, 4, 3, 1);
    px(2, 8, 1, 4);
  }

  function drawBalloon(b) {
    const ctx = api.ctx;
    const c = api.toScreenRect(b.x, b.y, 0, 0);
    const cx = Math.round(c.x), cy = Math.round(c.y + Math.sin(time * 2 + b.phase) * 1.2);
    const [base, dark, shine] = b.colors;
    const blink = b.life < 2 && Math.floor(b.life * 8) % 2;
    ctx.globalAlpha = blink ? 0.5 : 1;

    ctx.fillStyle = 'rgba(15, 50, 15, 0.35)';
    for (let dy = -b.r; dy <= b.r; dy++) {
      const w = Math.floor(Math.sqrt(b.r * b.r - dy * dy));
      ctx.fillRect(cx - w + 2, cy + dy + 3, w * 2 + 1, 1);
    }
    // Hilo
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    for (let i = 0; i < 5; i++) ctx.fillRect(cx + Math.round(Math.sin(time * 3 + i) * 0.6), cy + b.r + 2 + i, 1, 1);
    for (let dy = -b.r; dy <= b.r; dy++) {
      const w = Math.floor(Math.sqrt(b.r * b.r - dy * dy));
      ctx.fillStyle = dy > b.r * 0.4 ? dark : base;
      ctx.fillRect(cx - w, cy + dy, w * 2 + 1, 1);
      if (dy > -b.r * 0.4) {
        ctx.fillStyle = dark;
        ctx.fillRect(cx + w - 1, cy + dy, 1, 1); // sombra lateral
      }
    }
    ctx.fillStyle = dark;
    ctx.fillRect(cx - 1, cy + b.r, 3, 1); // nudo
    ctx.fillRect(cx, cy + b.r + 1, 1, 1);
    ctx.fillStyle = shine;
    ctx.fillRect(cx - Math.ceil(b.r / 2), cy - Math.ceil(b.r / 2), 2, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - Math.ceil(b.r / 2), cy - Math.ceil(b.r / 2), 1, 1);
    ctx.globalAlpha = 1;
  }

  function drawShields() {
    const rect = api.rect, ctx = api.ctx, H = api.H;
    // Barrera de energía en la línea de gol: núcleo brillante + resplandor
    for (const [p, x, glowX] of [[left, 0, 2], [right, W - 2, W - 4]]) {
      if (p.shield <= 0 || (p.shield < 3 && Math.floor(p.shield * 8) % 2)) continue;
      ctx.fillStyle = 'rgba(127, 232, 255, 0.25)';
      rect(glowX, 2, 2, H - 4);
      for (let y = 2; y < H - 2; y += 2) {
        ctx.fillStyle = `rgba(160, 240, 255, ${0.6 + 0.4 * Math.sin(time * 10 + y * 0.3)})`;
        rect(x, y, 2, 2);
      }
    }
  }

  // Capa bajo las paletas: globos, regalos y escudos
  function drawUnder() {
    for (const b of balloons) drawBalloon(b);
    for (const g of gifts) drawGift(g);
    drawShields();
  }

  // Capa de la pelota: fantasmas azules, del tamaño de la pelota, con aura y estela, que titilan
  function drawGhosts() {
    const rect = api.rect, ctx = api.ctx;
    for (const g of ghosts) {
      // [estela (rgb), aura, cuerpo, sombra, brillo]: azul normal o naranja si es de fuego
      const [trail, aura, body, shade, shine] = g.fire
        ? ['255, 140, 50', '#ffc78a', '#ff8a2a', '#b84a12', '#fff0d0']
        : ['95, 184, 255', '#9fd4ff', '#4da6ff', '#1d5fa8', '#e6f4ff'];
      g.trail.forEach((p, i) => {
        ctx.fillStyle = `rgba(${trail}, ${(i + 1) / g.trail.length * 0.5})`;
        rect(p.x + 1, p.y + 1, 2, 2);
      });
      const flicker = 0.75 + 0.25 * Math.sin(g.t * 14);
      ctx.globalAlpha = 0.35 * flicker;
      ctx.fillStyle = aura;
      rect(g.x - 1, g.y, BALL_SIZE + 2, BALL_SIZE);
      rect(g.x, g.y - 1, BALL_SIZE, BALL_SIZE + 2);
      ctx.globalAlpha = flicker;
      ctx.fillStyle = body;
      rect(g.x + 1, g.y, 2, 4);
      rect(g.x, g.y + 1, 4, 2);
      ctx.fillStyle = shade;
      rect(g.x + 3, g.y + 2, 1, 1);
      rect(g.x + 2, g.y + 3, 1, 1);
      ctx.fillStyle = shine;
      rect(g.x + 1, g.y + 1, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  return {
    reset, update, collide, checkShield, adjustHitSpeed, onGoal, checkComeback, drawUnder, drawGhosts,
    spawnGhosts, spawnBalloons,
    get ghosts() { return ghosts; },
    get gifts() { return gifts; },
    get balloons() { return balloons; },
    get slowBall() { return slowBall; },
  };
};
