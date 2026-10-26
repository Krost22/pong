// Música chiptune para los vídeos, sintetizada nota a nota (WAV estéreo de 16 bits).
//
// Armonía: Do mayor con la progresión vi–IV–I–V (Lam–Fa–Do–Sol). La melodía cae en notas del acorde en los
// tiempos fuertes y usa notas de paso en los débiles; dos frases de 4 compases (pregunta y respuesta) se
// alternan, y el final hace una cadencia IV–V–I para resolver en Do.
// Instrumentación al estilo NES: pulso 25% (melodía), pulso 12,5% (arpegio), triángulo (bajo), ruido
// (batería) y un pad suave. Osciladores de pulso con PolyBLEP (sin aliasing áspero), envolventes ADSR,
// eco en melodía y arpegio, compresión del bajo y el pad con cada bombo y limitador suave.
import fs from 'node:fs';

const SR = 44100;
const BPM = 140;
const BEAT = 60 / BPM, EIGHTH = BEAT / 2, SIXTEENTH = BEAT / 4, BAR = BEAT * 4;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

// Acordes: raíz del bajo, voces del pad (enlazadas, cerca del Do central) y notas del arpegio
const CHORDS = {
  Am: { bass: 45, pad: [57, 60, 64], arp: [57, 60, 64, 69] },
  F: { bass: 41, pad: [57, 60, 65], arp: [53, 57, 60, 65] },
  C: { bass: 48, pad: [55, 60, 64], arp: [55, 60, 64, 67] },
  G: { bass: 43, pad: [55, 59, 62], arp: [55, 59, 62, 67] },
};
const PROGRESSION = ['Am', 'F', 'C', 'G'];

// Melodía por compás: [nota MIDI, duración en corcheas] (8 corcheas por compás)
const PHRASE_A = {
  Am: [[76, 2], [81, 2], [79, 1], [76, 1], [72, 1], [74, 1]],
  F: [[77, 2], [76, 1], [72, 1], [69, 2], [72, 2]],
  C: [[79, 3], [76, 1], [72, 2], [76, 2]],
  G: [[74, 2], [79, 2], [83, 2], [81, 1], [79, 1]],
};
const PHRASE_B = {
  Am: [[81, 2], [84, 2], [83, 1], [81, 1], [79, 2]],
  F: [[77, 3], [79, 1], [81, 2], [84, 2]],
  C: [[84, 4], [79, 2], [76, 2]],
  G: [[79, 2], [83, 2], [86, 3], [83, 1]],
};
const CADENCE = [
  { chord: 'F', melody: [[77, 4], [81, 4]] },
  { chord: 'G', melody: [[79, 4], [83, 4]] },
];

// --- Osciladores ---
function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
const pulse = (duty) => (phase, dt) => {
  let v = phase < duty ? 1 : -1;
  v += polyblep(phase, dt);
  v -= polyblep((phase - duty + 1) % 1, dt);
  return v - (2 * duty - 1); // sin componente continua
};
const triangle = (phase) => 1 - 4 * Math.abs(Math.round(phase) - phase);
const softSaw = (phase, dt) => (2 * phase - 1) - polyblep(phase, dt);

function adsr(t, dur, a, d, s, r) {
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * (t - a) / d;
  if (t < dur) return s;
  return Math.max(0, s * (1 - (t - dur) / r));
}

export function writeMusic(seconds, file) {
  const n = Math.ceil(seconds * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const echoL = new Float32Array(n), echoR = new Float32Array(n); // envío al eco
  const duckable = new Float32Array(n * 2); // bajo + pad (se atenúan con el bombo), intercalado L/R
  const kicks = [];

  // Toca una nota sumándola en el destino indicado
  function note(start, dur, midi, osc, { vol = 0.2, pan = 0, a = 0.005, d = 0.08, s = 0.7, r = 0.08, vib = 0, echo = 0, duck = false, detune = 0 } = {}) {
    const s0 = Math.floor(start * SR), s1 = Math.min(n, Math.floor((start + dur + r) * SR));
    const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    let phase = Math.random();
    for (let i = s0; i < s1; i++) {
      const t = (i - s0) / SR;
      const vibrato = vib && t > 0.12 ? 1 + vib * Math.sin(2 * Math.PI * 5.5 * t) : 1;
      const f = hz(midi + detune) * vibrato, dt = f / SR;
      phase += dt;
      if (phase >= 1) phase -= 1;
      const v = osc(phase, dt) * adsr(t, dur, a, d, s, r) * vol;
      if (duck) { duckable[i * 2] += v * gl; duckable[i * 2 + 1] += v * gr; }
      else { L[i] += v * gl; R[i] += v * gr; }
      if (echo) { echoL[i] += v * gl * echo; echoR[i] += v * gr * echo; }
    }
  }

  let seed = 12345;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1;
  function drum(start, kind, vol = 1) {
    const dur = { kick: 0.25, snare: 0.18, hat: 0.05, crash: 1.2 }[kind];
    const s0 = Math.floor(start * SR), s1 = Math.min(n, s0 + Math.floor(dur * SR));
    let phase = 0, lp = 0, prev = 0;
    if (kind === 'kick') kicks.push(start);
    for (let i = s0; i < s1; i++) {
      const t = (i - s0) / SR;
      let v = 0;
      if (kind === 'kick') {
        phase += (45 + 110 * Math.exp(-t * 28)) / SR;
        v = Math.sin(2 * Math.PI * phase) * Math.exp(-t * 9) * 0.72 + (t < 0.004 ? noise() * 0.3 : 0);
      } else if (kind === 'snare') {
        const nz = noise();
        lp += 0.35 * (nz - lp); // ruido algo filtrado
        phase += 185 / SR;
        v = (lp * 0.9 * Math.exp(-t * 20) + Math.sin(2 * Math.PI * phase) * 0.35 * Math.exp(-t * 30)) * 0.55;
      } else {
        const nz = noise(), hp = nz - prev; // ruido agudo (paso alto simple)
        prev = nz;
        v = hp * (kind === 'hat' ? 0.22 * Math.exp(-t * 70) : 0.16 * Math.exp(-t * 3.5));
      }
      v *= vol;
      const pan = kind === 'hat' ? 0.25 : 0;
      L[i] += v * Math.cos((pan + 1) * Math.PI / 4) * 1.41;
      R[i] += v * Math.sin((pan + 1) * Math.PI / 4) * 1.41;
    }
  }

  const lead = pulse(0.25), arpOsc = pulse(0.125);
  const playBar = (t0, chordName, melody, { drums = true, intro = false } = {}) => {
    const ch = CHORDS[chordName];
    // Pad: dos sierras suaves algo desafinadas para dar anchura (ataque lento)
    for (const m of ch.pad) {
      note(t0, BAR, m, softSaw, { vol: intro ? 0.035 : 0.028, pan: -0.5, a: 0.25, d: 0.3, s: 0.8, r: 0.3, duck: true, detune: -0.08 });
      note(t0, BAR, m, softSaw, { vol: intro ? 0.035 : 0.028, pan: 0.5, a: 0.25, d: 0.3, s: 0.8, r: 0.3, duck: true, detune: 0.08 });
    }
    // Arpegio en semicorcheas (arriba y abajo), a la izquierda y con eco
    const order = [0, 1, 2, 3, 2, 1, 0, 1];
    for (let k = 0; k < 16; k++) {
      note(t0 + k * SIXTEENTH, SIXTEENTH * 0.85, ch.arp[order[k % 8]] + 12, arpOsc, { vol: intro ? 0.045 : 0.05, pan: -0.35, a: 0.002, d: 0.05, s: 0.5, r: 0.04, echo: 0.35 });
    }
    if (intro) return;
    // Bajo de triángulo en corcheas: raíz, raíz, octava... y nota de paso (quinta) al final del compás
    const pattern = [0, 0, 12, 0, 0, 12, 0, 7];
    pattern.forEach((off, k) => note(t0 + k * EIGHTH, EIGHTH * 0.8, ch.bass + off, triangle, { vol: 0.24, a: 0.003, d: 0.06, s: 0.8, r: 0.03, duck: true }));
    // Melodía con vibrato y eco
    let tt = t0;
    for (const [m, len] of melody) {
      note(tt, len * EIGHTH * 0.92, m, lead, { vol: 0.13, pan: 0.05, a: 0.006, d: 0.1, s: 0.65, r: 0.08, vib: 0.006, echo: 0.3 });
      tt += len * EIGHTH;
    }
    if (drums) {
      for (let b = 0; b < 4; b++) {
        drum(t0 + b * BEAT, b % 2 === 0 ? 'kick' : 'snare');
        drum(t0 + b * BEAT + EIGHTH, 'hat', 0.8);
        drum(t0 + b * BEAT, 'hat', 0.5);
      }
      drum(t0 + 3 * BEAT + EIGHTH + SIXTEENTH, 'kick', 0.7); // anticipación del siguiente compás
    }
  };

  // Estructura, toda sobre la rejilla de compases: 1 compás de intro (pad + arpegio), cuerpo con frases A/B
  // sin huecos, cadencia IV–V y el Do final al empezar un compás (fuera de la rejilla se oye un tropiezo).
  // Lo que sobra tras el último compás es la cola del acorde final, que suena hasta el final del vídeo.
  const endBar = Math.max(4, Math.floor((seconds - 1.6) / BAR));
  const endChord = endBar * BAR, cadenceStart = endChord - 2 * BAR;
  playBar(0, 'Am', null, { intro: true });
  for (let bar = 1; bar < endBar - 2; bar++) {
    const chordName = PROGRESSION[(bar - 1) % 4];
    const phrase = Math.floor((bar - 1) / 4) % 2 === 0 ? PHRASE_A : PHRASE_B;
    playBar(bar * BAR, chordName, phrase[chordName]);
    if ((bar - 1) % 8 === 0) drum(bar * BAR, 'crash', 0.9);
  }
  CADENCE.forEach((c, i) => playBar(cadenceStart + i * BAR, c.chord, c.melody));
  // Acorde final de Do: pad, arpegio lento, bajo y melodía en la tónica, con platillo
  const fin = CHORDS.C, rest = seconds - endChord;
  drum(endChord, 'crash', 1);
  drum(endChord, 'kick', 1);
  note(endChord, rest * 0.8, fin.bass - 12, triangle, { vol: 0.35, a: 0.005, d: 0.2, s: 0.8, r: rest * 0.2, duck: true });
  for (const m of [...fin.pad, 72]) note(endChord, rest * 0.75, m, softSaw, { vol: 0.04, a: 0.02, d: 0.4, s: 0.7, r: rest * 0.25 });
  note(endChord, rest * 0.7, 84, lead, { vol: 0.12, a: 0.01, d: 0.2, s: 0.6, r: rest * 0.3, vib: 0.008, echo: 0.3 });
  fin.arp.forEach((m, k) => note(endChord + k * 0.08, rest * 0.6, m + 12, arpOsc, { vol: 0.05, a: 0.003, d: 0.2, s: 0.4, r: rest * 0.3, echo: 0.3 }));

  // Bajo y pad: se atenúan un instante con cada bombo para dejarle sitio
  const duckGain = new Float32Array(n).fill(1);
  for (const k of kicks) {
    const s0 = Math.floor(k * SR), len = Math.floor(0.18 * SR);
    for (let i = 0; i < len && s0 + i < n; i++) duckGain[s0 + i] = Math.min(duckGain[s0 + i], 0.45 + 0.55 * (i / len));
  }
  for (let i = 0; i < n; i++) {
    L[i] += duckable[i * 2] * duckGain[i];
    R[i] += duckable[i * 2 + 1] * duckGain[i];
  }

  // Eco a contratiempo de corchea con puntillo, rebotando entre canales
  const delay = Math.floor(EIGHTH * 1.5 * SR);
  for (let i = delay; i < n; i++) {
    echoL[i] += echoR[i - delay] * 0.38;
    echoR[i] += echoL[i - delay] * 0.38;
  }
  for (let i = 0; i < n; i++) {
    L[i] += echoL[i] * 0.45;
    R[i] += echoR[i] * 0.45;
  }

  // Filtro paso bajo muy suave (quita aspereza), fundidos y limitador suave con normalización
  let lpL = 0, lpR = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    lpL += 0.55 * (L[i] - lpL);
    lpR += 0.55 * (R[i] - lpR);
    const fade = Math.min(1, i / (0.05 * SR), (n - i) / (0.8 * SR));
    L[i] = Math.tanh(lpL * 1.4) * fade;
    R[i] = Math.tanh(lpR * 1.4) * fade;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const gain = 0.89 / (peak || 1);
  const pcm = Buffer.alloc(44 + n * 4);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + n * 4, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12);
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(SR, 24);
  pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), 44 + i * 4);
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, pcm);
}

// Uso directo: node music.mjs <segundos> <salida.wav>
if (process.argv[1] && process.argv[1].endsWith('music.mjs') && process.argv[3]) {
  writeMusic(+process.argv[2], process.argv[3]);
  console.log('música lista:', process.argv[3]);
}
