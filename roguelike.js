// Modo RogueLike ("Rogue Pong"): una run de 3 pisos con salas cortas contra rivales con rasgos,
// corazones que no se recuperan solos, mejoras acumulables, tienda, descanso y jefes.
// Usa el motor del Pong moderno: game.js le avisa de goles y golpes y le pide modificadores.
window.PongRoguelike = (api) => {
  'use strict';

  const { ball, left, right } = api;
  const sfx = () => api.sfx();
  const $ = (id) => document.getElementById(id);

  // --- Balance (todo aquí para ajustarlo fácil) ---
  const SAVE_KEY = 'pong.roguelike.save';
  const FLOORS = 3, ROOMS_PER_FLOOR = 4; // la última sala de cada piso es el jefe
  const START_HEARTS = 5, REST_HEAL = 2, FLOOR_HEAL = 2, REVIVE_HEARTS = 2;
  const TARGET = { combat: 3, elite: 4 }; // goles para superar la sala (los jefes usan su vida)
  const COINS = { goal: 2, room: 5, elite: 10, boss: 20, fire: 1, fuse: 2, skip: 5 };
  const PRICES = { common: 15, rare: 30, legendary: 50 };
  const HEAL_PRICE = 10;
  const DIFF_STEP = 0.04, ELITE_DIFF = 0.08; // dificultad que sube con cada sala
  const FIRE_SPEED = 215;
  const REWARD_DELAY = 1.4;
  const RAGE_SPEED = 1.25, RAGE_TIMERS = 1.6; // jefe enfurecido (con la mitad de vida o menos)
  const RARITY_WEIGHTS = {
    reward: { common: 65, rare: 30, legendary: 5 },
    shop: { common: 50, rare: 40, legendary: 10 },
  };
  const RARITY_NAMES = { common: 'COMÚN', rare: 'RARA', legendary: 'LEGENDARIA' };

  const FLOOR_INFO = {
    1: { name: 'CÉSPED', theme: 'grass' },
    2: { name: 'HIELO', theme: 'ice' },
    3: { name: 'VOLCÁN', theme: 'lava' },
  };

  const DOORS = {
    combat: { label: 'COMBATE', desc: 'Rival normal', letter: 'C', weight: 45 },
    elite: { label: 'ÉLITE', desc: 'Más duro, mejor premio', letter: 'E', weight: 20 },
    shop: { label: 'TIENDA', desc: 'Gasta tus monedas', letter: 'T', weight: 18 },
    rest: { label: 'DESCANSO', desc: 'Cúrate o entrena', letter: 'D', weight: 17 },
    boss: { label: 'JEFE', desc: '', letter: 'J', weight: 0 },
  };

  // size = alto de su paleta; speed/reaction/error = multiplicadores de la IA (reaction y error: menos = mejor)
  const ENEMIES = {
    1: [
      { name: 'NOVATO', size: 1, speed: 0.85, reaction: 1.2, error: 1.3, traits: [] },
      { name: 'MURALLA', size: 1.5, speed: 0.75, reaction: 1.1, error: 1.1, traits: [] },
      { name: 'RAYO', size: 0.75, speed: 1.35, reaction: 0.8, error: 1, traits: [] },
    ],
    2: [
      { name: 'ILUSIONISTA', size: 1, speed: 1, reaction: 1, error: 1, traits: ['ghosts'] },
      { name: 'ESCARCHA', size: 1, speed: 1, reaction: 1, error: 1, traits: ['freeze'] },
    ],
    3: [
      { name: 'PIRÓMANO', size: 1, speed: 1.05, reaction: 0.95, error: 1, traits: ['fire'] },
      { name: 'ACORAZADO', size: 1.2, speed: 0.95, reaction: 1, error: 1, traits: ['shield'] },
    ],
  };
  const ELITE_TRAITS = ['ghosts', 'freeze', 'shield', 'fire'];
  const BOSSES = {
    1: { name: 'EL MURO', look: 'wall', size: 2, speed: 0.8, reaction: 1, error: 0.9, hp: 5, traits: ['wall'] },
    2: { name: 'REY DE HIELO', look: 'iceking', size: 1.3, speed: 1.05, reaction: 0.9, error: 0.9, hp: 6, traits: ['freeze', 'ghosts'] },
    3: { name: 'DRAGÓN', look: 'dragon', size: 1.3, speed: 1.1, reaction: 0.9, error: 0.85, hp: 7, traits: ['fire', 'fireGhosts'], rageTraits: ['balloons'] },
  };

  // Comportamientos periódicos del rival. run() devuelve false si no era buen momento (se reintenta pronto).
  // 'fire' (pelota que arde antes) y 'wall' (escudo cada 2 goles) son pasivos.
  const TRAITS = {
    ghosts: {
      every: 6,
      run: () => {
        if (ball.vx >= 0) return false; // solo cuando la pelota va hacia ti: te despista
        api.powerups.spawnGhosts(1);
        sfx().ghost();
        return true;
      },
    },
    fireGhosts: {
      every: 7,
      run: () => {
        if (ball.vx >= 0) return false;
        api.powerups.spawnGhosts(2, true);
        sfx().ignite();
        return true;
      },
    },
    freeze: {
      every: 8,
      run: () => {
        if (ball.vx <= 0 || left.frozen > 0) return false; // solo cuando la pelota se aleja: es justo
        left.frozen = 1;
        api.fx().burst(left.x + 2, left.y + left.h / 2, ['#9fe6ff', '#ffffff'], 18, 70);
        sfx().freeze();
        return true;
      },
    },
    shield: {
      every: 10,
      run: () => {
        if (right.shield > 0) return false;
        right.shield = 8;
        sfx().shield();
        return true;
      },
    },
    balloons: {
      every: 12,
      run: () => {
        if (api.powerups.balloons.length) return false;
        api.powerups.spawnBalloons();
        sfx().balloons();
        return true;
      },
    },
  };

  const UPGRADES = [
    { id: 'long', name: 'PALETA LARGA', rarity: 'common', max: 3, desc: 'Tu paleta crece un 20%.' },
    { id: 'heart', name: 'CORAZÓN', rarity: 'common', max: 3, desc: '+1 corazón máximo y te cura 1.' },
    { id: 'pocket', name: 'BOLSILLO', rarity: 'common', max: 2, desc: 'Ganas un 50% más de monedas.' },
    { id: 'power', name: 'GOLPE POTENTE', rarity: 'common', max: 3, desc: 'Tus golpes aceleran más la pelota.' },
    { id: 'spin', name: 'EFECTO', rarity: 'common', max: 2, desc: 'Tus golpes salen con más ángulo.' },
    { id: 'serve', name: 'SAQUE FUERTE', rarity: 'common', max: 1, desc: 'Los saques hacia el rival van un 25% más rápido.' },
    { id: 'shield', name: 'ESCUDO DE INICIO', rarity: 'rare', max: 1, desc: 'Empiezas cada sala con escudo.' },
    { id: 'magnet', name: 'IMÁN DE REGALOS', rarity: 'rare', max: 1, desc: 'Los regalos aparecen el doble de seguido.' },
    { id: 'fuse', name: 'MECHA CORTA', rarity: 'rare', max: 1, desc: 'La pelota arde antes y cada gol de fuego da +2 monedas.' },
    { id: 'vampire', name: 'VAMPIRO', rarity: 'rare', max: 1, desc: 'Cada 3 goles tuyos recuperas 1 corazón.' },
    { id: 'specter', name: 'ESPECTRO', rarity: 'rare', max: 1, desc: 'Al golpear, 25% de lanzar una bola fantasma que engaña al rival.' },
    { id: 'freezer', name: 'CONGELADOR', rarity: 'rare', max: 1, desc: 'Al golpear, 15% de congelar al rival.' },
    { id: 'revive', name: 'SEGUNDA VIDA', rarity: 'legendary', max: 1, desc: 'Una vez por run, al quedarte sin corazones revives con 2.' },
    { id: 'golden', name: 'GOL DE ORO', rarity: 'legendary', max: 1, desc: 'Tus goles de fuego cuentan doble.' },
    { id: 'brake', name: 'FRENO', rarity: 'legendary', max: 1, desc: 'Los golpes del rival salen un 20% más lentos.' },
    { id: 'titan', name: 'TITÁN', rarity: 'legendary', max: 1, desc: 'Tu paleta crece un 50% más.' },
    { id: 'goldheart', name: 'CORAZÓN DE ORO', rarity: 'legendary', max: 1, desc: '+2 corazones máximos y curación total.' },
  ];

  let run = null;       // estado guardable de la run
  let enemy = null;     // rival de la sala actual (no se guarda)
  let roomKind = null;
  let target = 0;       // goles para superar la sala
  let pending = null;   // pantalla que se abre tras una pausa
  let shopStock = [];
  let banner = '';      // aviso que se muestra una vez en el mapa (p. ej. nuevo piso)
  let keyActions = [];  // teclas 1-9 en las pantallas entre salas
  const timers = {};

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const stack = (id) => (run && run.stacks[id]) || 0;
  const has = (id) => stack(id) > 0;

  function newRun() {
    return {
      floor: 1, room: 0, hearts: START_HEARTS, maxHearts: START_HEARTS, coins: 0, stacks: {},
      goals: 0, rooms: 0, bosses: 0, revived: false, vamp: 0, doors: null, path: [],
    };
  }

  // --- Guardado (entre salas) ---
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, run })); } catch (_) { /* sin almacenamiento */ }
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(SAVE_KEY));
      return data && data.v === 1 && data.run ? data.run : null;
    } catch (_) {
      return null;
    }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (_) { /* sin almacenamiento */ }
  }

  function saveInfo() {
    const r = load();
    return r ? `RUN GUARDADA: PISO ${r.floor} · SALA ${r.room + 1} · ♥ ${r.hearts}` : null;
  }

  // --- Modificadores que consulta game.js ---
  const playerSize = () => 1 + 0.2 * stack('long') + 0.5 * stack('titan');
  const coinMult = () => 1 + 0.5 * stack('pocket');
  const giftRate = () => (has('magnet') ? 2 : 1);

  function difficulty() {
    if (!run) return 1;
    const n = (run.floor - 1) * ROOMS_PER_FLOOR + run.room;
    return 1 + DIFF_STEP * n + (roomKind === 'elite' ? ELITE_DIFF : 0);
  }

  function fireSpeed() {
    let s = FIRE_SPEED;
    if (has('fuse')) s -= 45;
    if (run && run.floor === 3) s -= 20;
    if (enemy && enemy.traits.includes('fire')) s -= 60;
    return s;
  }

  // Golpe potente acelera tus golpes; Freno frena los del rival (y lo compensa en los tuyos)
  function adjustHitSpeed(side, speed, max) {
    if (side === 'left') {
      speed *= 1 + 0.04 * stack('power');
      if (has('brake')) speed /= 0.8;
    } else if (has('brake')) {
      speed *= 0.8;
    }
    return Math.min(speed, max);
  }

  function adjustAngle(side, angle) {
    if (side !== 'left' || !has('spin')) return angle;
    const a = angle * (1 + 0.15 * stack('spin'));
    return Math.max(-1.25, Math.min(1.25, a));
  }

  const serveMult = (dir) => (dir > 0 && has('serve') ? 1.25 : 1);

  function onPlayerHit() {
    if (has('specter') && Math.random() < 0.25) api.powerups.spawnGhosts(1);
    if (has('freezer') && right.frozen <= 0 && Math.random() < 0.15) {
      right.frozen = 0.8;
      api.fx().burst(right.x + 2, right.y + right.h / 2, ['#9fe6ff', '#ffffff'], 16, 70);
      sfx().freeze();
    }
  }

  // --- HUD ---
  // Datos para el HUD de texto (game.js lo pinta como insignias: piso, rival y monedas)
  function hudData() {
    if (!run) return null;
    const floor = Math.min(run.floor, FLOORS); // tras ganar, run.floor pasa a 4
    return {
      floor, room: run.room, rooms: ROOMS_PER_FLOOR, theme: FLOOR_INFO[floor].theme,
      floorName: FLOOR_INFO[floor].name, enemy: enemy ? enemy.name : null, boss: !!(enemy && enemy.boss),
      coins: run.coins,
    };
  }

  const updateHud = () => api.setHud(hudData());

  // Datos para el HUD dibujado en la cancha (corazones, objetivo, jefe y diseño del rival)
  function hudInfo() {
    if (!run) return null;
    return {
      hearts: run.hearts,
      maxHearts: run.maxHearts,
      target: enemy ? target : 0,
      goals: left.score,
      // Diseño de la paleta rival: el del jefe o el del piso (madera, cristal u obsidiana)
      look: enemy ? enemy.look || FLOOR_INFO[Math.min(run.floor, FLOORS)].theme : null,
      elite: roomKind === 'elite',
      boss: enemy && enemy.boss ? { left: Math.max(0, target - left.score), max: target, rage: enemy.rage } : null,
    };
  }

  // Línea de estado de las pantallas entre salas: corazones y monedas como insignias
  function stats(prefix = '') {
    const el = $('rogue-sub');
    el.textContent = prefix;
    const hearts = document.createElement('span');
    hearts.className = 'pill hearts';
    hearts.textContent = `♥ ${run.hearts}/${run.maxHearts}`;
    const coins = document.createElement('span');
    coins.className = 'pill coins';
    const icon = document.createElement('i');
    icon.className = 'coin';
    coins.append(icon, String(run.coins));
    el.append(hearts, coins);
  }

  function ownedText() {
    const owned = UPGRADES.filter((u) => has(u.id)).map((u) => u.name + (stack(u.id) > 1 ? ` x${stack(u.id)}` : ''));
    return owned.length ? `MEJORAS: ${owned.join(' · ')}` : 'SIN MEJORAS TODAVÍA';
  }

  // --- Monedas y corazones ---
  function gainCoins(n) {
    run.coins += Math.round(n * coinMult());
    sfx().coin();
    updateHud();
  }

  function heal(n) {
    run.hearts = Math.min(run.maxHearts, run.hearts + n);
    sfx().heal();
  }

  // --- Cartas ---
  function rollRarity(weights) {
    const total = Object.values(weights).reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    for (const [rarity, w] of Object.entries(weights)) if ((r -= w) < 0) return rarity;
    return 'common';
  }

  function available(rarity, exclude) {
    return UPGRADES.filter((u) => (!rarity || u.rarity === rarity) && stack(u.id) < u.max && !exclude.includes(u));
  }

  // n cartas distintas; la primera de la rareza garantizada (si la hay) y luego se barajan
  function offerCards(n, guaranteed, weights = RARITY_WEIGHTS.reward, onlyRarity = null) {
    const chosen = [];
    for (let i = 0; i < n; i++) {
      const rarity = onlyRarity || (i === 0 && guaranteed) || rollRarity(weights);
      let pool = available(rarity, chosen);
      if (!pool.length) pool = available(onlyRarity, chosen);
      if (!pool.length) pool = available(null, chosen);
      if (!pool.length) break;
      chosen.push(pick(pool));
    }
    for (let i = chosen.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
    }
    return chosen;
  }

  function take(u) {
    run.stacks[u.id] = stack(u.id) + 1;
    if (u.id === 'heart') {
      run.maxHearts++;
      run.hearts++;
    } else if (u.id === 'goldheart') {
      run.maxHearts += 2;
      run.hearts = run.maxHearts;
    }
    sfx().card();
  }

  // --- Pantallas entre salas (overlay #rogue) ---
  function button(className, parts, onClick, disabled = false) {
    const b = document.createElement('button');
    b.className = className;
    for (const [cls, text] of parts) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      b.appendChild(span);
    }
    b.disabled = disabled;
    b.addEventListener('click', () => {
      b.blur();
      onClick();
    });
    return b;
  }

  function cardButton(u, onPick, { price = null, sold = false } = {}) {
    const n = stack(u.id);
    const parts = [
      ['rarity', RARITY_NAMES[u.rarity] + (u.max > 1 ? ` · ${n}/${u.max}` : '')],
      ['name', u.name],
      ['desc', u.desc],
    ];
    if (price !== null) parts.push(['price', sold ? 'VENDIDO' : `${price} MONEDAS`]);
    return button(`card ${u.rarity}`, parts, onPick, sold || (price !== null && run.coins < price));
  }

  function render({ title, sub = '', map = false, items = [], note = '', actions = [] }) {
    $('rogue-title').textContent = title;
    stats(sub);
    const mapEl = $('rogue-map');
    mapEl.innerHTML = '';
    mapEl.classList.toggle('hidden', !map);
    if (map) {
      for (let i = 0; i < ROOMS_PER_FLOOR; i++) {
        const node = document.createElement('span');
        const boss = i === ROOMS_PER_FLOOR - 1;
        node.className = 'node' + (i < run.room ? ' done' : '') + (i === run.room ? ' current' : '') + (boss ? ' boss' : '');
        node.textContent = i < run.room ? (DOORS[run.path[i]] || {}).letter || '' : (boss ? 'J' : '');
        mapEl.appendChild(node);
      }
    }
    const box = $('rogue-items');
    box.innerHTML = '';
    items.forEach((el) => box.appendChild(el));
    $('rogue-note').textContent = note;
    const act = $('rogue-actions');
    act.innerHTML = '';
    for (const a of actions) act.appendChild(button('', [['label', a.label]], a.fn, a.disabled));
    keyActions = items.map((el) => () => { if (!el.disabled) el.click(); });
    api.showRogue();
  }

  function makeDoors() {
    if (run.room === ROOMS_PER_FLOOR - 1) return ['boss'];
    if (run.floor === 1 && run.room === 0) return ['combat'];
    const weighted = (kinds) => {
      let r = Math.random() * kinds.reduce((s, k) => s + DOORS[k].weight, 0);
      for (const k of kinds) if ((r -= DOORS[k].weight) < 0) return k;
      return kinds[0];
    };
    const kinds = ['combat', 'elite', 'shop', 'rest'];
    const first = weighted(kinds);
    let second = weighted(kinds.filter((k) => k !== first));
    const fight = (k) => k === 'combat' || k === 'elite';
    if (!fight(first) && !fight(second)) second = 'combat'; // siempre hay al menos una pelea
    return [first, second];
  }

  function showMap() {
    enemy = null;
    roomKind = null;
    if (!run.doors) run.doors = makeDoors();
    save();
    const doors = run.doors.map((kind) => {
      const d = DOORS[kind];
      return button(`door ${kind}`, [['name', d.label], ['desc', kind === 'boss' ? BOSSES[run.floor].name : d.desc]], () => enterRoom(kind));
    });
    render({
      title: `PISO ${run.floor} · ${FLOOR_INFO[run.floor].name}`,
      map: true,
      items: doors,
      note: banner || ownedText(),
      actions: [{ label: 'MENÚ', fn: api.toMenu }],
    });
    banner = '';
    updateHud();
  }

  function showReward(kind) {
    const offers = offerCards(3, kind === 'boss' ? 'legendary' : (kind === 'elite' ? 'rare' : null));
    render({
      title: kind === 'boss' ? '¡JEFE DERROTADO!' : '¡SALA SUPERADA!',
      sub: 'ELIGE UNA MEJORA ',
      items: offers.map((u) => cardButton(u, () => { take(u); advance(); })),
      note: ownedText(),
      actions: [{ label: `SALTAR (+${COINS.skip} MONEDAS)`, fn: () => { gainCoins(COINS.skip); advance(); } }],
    });
  }

  function showShop() {
    shopStock = offerCards(3, null, RARITY_WEIGHTS.shop).map((u) => ({ u, sold: false }));
    renderShop();
  }

  function renderShop() {
    render({
      title: 'TIENDA',
      items: shopStock.map((s) => {
        const price = PRICES[s.u.rarity];
        return cardButton(s.u, () => {
          if (run.coins < price || s.sold) return;
          run.coins -= price;
          s.sold = true;
          take(s.u);
          sfx().coin();
          renderShop();
        }, { price, sold: s.sold });
      }),
      note: ownedText(),
      actions: [
        {
          label: `CURAR 1 ♥ (${HEAL_PRICE} MONEDAS)`,
          disabled: run.coins < HEAL_PRICE || run.hearts >= run.maxHearts,
          fn: () => {
            run.coins -= HEAL_PRICE;
            heal(1);
            renderShop();
          },
        },
        { label: 'SEGUIR', fn: advance },
      ],
    });
  }

  function showRest() {
    render({
      title: 'DESCANSO',
      items: [
        button('door rest', [['name', 'DESCANSAR'], ['desc', `+${REST_HEAL} ♥`]], () => { heal(REST_HEAL); advance(); }),
        button('door combat', [['name', 'ENTRENAR'], ['desc', 'Una mejora común gratis']], showTrain),
      ],
      note: ownedText(),
    });
  }

  function showTrain() {
    const offers = offerCards(2, null, RARITY_WEIGHTS.reward, 'common');
    render({
      title: 'ENTRENAR',
      sub: 'ELIGE UNA ',
      items: offers.map((u) => cardButton(u, () => { take(u); advance(); })),
      note: ownedText(),
      actions: [{ label: 'VOLVER', fn: showRest }],
    });
  }

  // --- Salas ---
  function makeEnemy(kind) {
    if (kind === 'boss') {
      const b = BOSSES[run.floor];
      return { ...b, traits: [...b.traits], boss: true, rage: false };
    }
    const base = pick(ENEMIES[run.floor]);
    const e = { ...base, traits: [...base.traits], boss: false, rage: false };
    if (kind === 'elite') {
      const extra = ELITE_TRAITS.filter((t) => !e.traits.includes(t));
      if (extra.length) e.traits.push(pick(extra));
      e.name = `${e.name} ÉLITE`;
      e.speed *= 1.15;
      e.reaction *= 0.85;
      e.error *= 0.8;
    }
    return e;
  }

  function enterRoom(kind) {
    sfx().door();
    run.path[run.room] = kind;
    roomKind = kind;
    if (kind === 'shop') return showShop();
    if (kind === 'rest') return showRest();
    enemy = makeEnemy(kind);
    target = kind === 'boss' ? enemy.hp : TARGET[kind];
    for (const k of Object.keys(timers)) delete timers[k];
    for (const t of enemy.traits) if (TRAITS[t]) timers[t] = TRAITS[t].every * rand(0.5, 1);
    keyActions = [];
    api.beginRoom({
      theme: FLOOR_INFO[run.floor].theme,
      playerSize: playerSize(),
      enemySize: enemy.size,
      shield: has('shield'),
    });
    if (enemy.boss) {
      api.showMsg(`¡JEFE: ${enemy.name}!`, 2);
      api.fx().shake(0.6);
      sfx().roar();
    } else {
      api.showMsg(enemy.name, 1.4);
    }
    updateHud();
  }

  function checkRage() {
    if (!enemy.boss || enemy.rage || target - left.score > Math.floor(target / 2)) return;
    enemy.rage = true;
    for (const t of enemy.rageTraits || []) {
      enemy.traits.push(t);
      timers[t] = 2;
    }
    api.showMsg(`¡${enemy.name} SE ENFURECE!`, 1.6);
    api.fx().shake(0.5);
    sfx().roar();
  }

  // Lo llama game.js en cada gol. Devuelve 'continue', 'roomCleared' o 'runOver'.
  function onGoal(side, fiery) {
    if (side === 'left') {
      run.goals++;
      if (fiery && has('golden')) {
        left.score++;
        api.showMsg('¡GOL DE ORO! x2', 1.2);
      }
      gainCoins(COINS.goal + (fiery ? COINS.fire + (has('fuse') ? COINS.fuse : 0) : 0));
      if (has('vampire') && ++run.vamp % 3 === 0 && run.hearts < run.maxHearts) {
        heal(1);
        api.showMsg('VAMPIRO: +1 ♥', 1.2);
      }
      if (left.score >= target) return clearRoom();
      if (enemy.traits.includes('wall') && left.score % 2 === 0) {
        right.shield = 15;
        sfx().shield();
      }
      checkRage();
      api.showMsg(`¡GOL! ${left.score}/${target}`, 0.8);
      return 'continue';
    }

    // Gol en contra: cuesta un corazón
    run.hearts--;
    api.fx().heartLost(Math.max(0, run.hearts), fiery); // el corazón estalla (o arde si fue gol de fuego)
    sfx().heartLost();
    api.fx().shake(0.3);
    if (run.hearts <= 0) {
      if (has('revive') && !run.revived) {
        run.revived = true;
        run.hearts = REVIVE_HEARTS;
        sfx().heal();
        api.showMsg('¡SEGUNDA VIDA!', 1.8);
        api.fx().celebrate('left');
        return 'continue';
      }
      finish(false);
      return 'runOver';
    }
    api.showMsg(`¡GOL EN CONTRA! ♥ ${run.hearts}`, 1);
    return 'continue';
  }

  function clearRoom() {
    const kind = roomKind;
    run.rooms++;
    if (kind === 'boss') run.bosses++;
    gainCoins(COINS.room + (kind === 'elite' ? COINS.elite : 0) + (kind === 'boss' ? COINS.boss : 0));
    api.showMsg(kind === 'boss' ? '¡JEFE DERROTADO!' : '¡SALA SUPERADA!', REWARD_DELAY);
    if (kind === 'boss') api.fx().celebrate('left');
    sfx().levelClear();
    enemy = null;
    pending = { t: REWARD_DELAY, fn: () => showReward(kind) };
    return 'roomCleared';
  }

  function advance() {
    run.room++;
    run.doors = null;
    if (run.room >= ROOMS_PER_FLOOR) {
      run.floor++;
      run.room = 0;
      run.path = [];
      if (run.floor > FLOORS) {
        finish(true);
        return;
      }
      run.hearts = Math.min(run.maxHearts, run.hearts + FLOOR_HEAL);
      api.setTheme(FLOOR_INFO[run.floor].theme);
      banner = `¡LLEGAS AL PISO ${run.floor}: ${FLOOR_INFO[run.floor].name}! (+${FLOOR_HEAL} ♥)`;
    }
    showMap();
  }

  function finish(victory) {
    clearSave();
    enemy = null;
    pending = null;
    const points = run.goals * 10 + run.rooms * 25 + run.bosses * 100 + run.coins;
    api.endRun({
      title: victory ? '¡RUN COMPLETADA!' : 'FIN DE LA RUN',
      points,
      detail: victory ? 'COMPLETADA' : `PISO ${run.floor}`,
      victory,
    });
  }

  // --- Ciclo ---
  function startRun() {
    clearSave();
    run = newRun();
    banner = '';
    api.prepare(FLOOR_INFO[1].theme);
    showMap();
  }

  function continueRun() {
    const saved = load();
    if (!saved) {
      startRun();
      return;
    }
    run = saved;
    run.path = run.path || [];
    banner = '';
    api.prepare(FLOOR_INFO[run.floor].theme);
    showMap();
  }

  function update(dt) {
    if (pending && (pending.t -= dt) <= 0) {
      const fn = pending.fn;
      pending = null;
      fn();
    }
    if (!enemy || api.state !== 'play') return;
    const speedUp = enemy.rage ? RAGE_TIMERS : 1;
    for (const t of enemy.traits) {
      if (!TRAITS[t]) continue;
      if ((timers[t] -= dt * speedUp) <= 0) timers[t] = TRAITS[t].run() ? TRAITS[t].every : 0.5;
    }
  }

  function key(code) {
    const m = /^(Digit|Numpad)([1-9])$/.exec(code);
    if (m && keyActions[+m[2] - 1]) keyActions[+m[2] - 1]();
  }

  return {
    startRun, continueRun, saveInfo, onGoal, onPlayerHit, adjustHitSpeed, adjustAngle, serveMult,
    update, key, difficulty, fireSpeed, giftRate, hudInfo, hudData,
    hasSave: () => !!load(),
    get ai() {
      return enemy ? { speed: enemy.speed * (enemy.rage ? RAGE_SPEED : 1), reaction: enemy.reaction, error: enemy.error } : null;
    },
    // Solo para pruebas (index.html?debug)
    get run() { return run; },
    get enemy() { return enemy; },
    get upgrades() { return UPGRADES; },
  };
};
