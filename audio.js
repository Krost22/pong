// Sonidos del juego: "classic" (pitidos de onda cuadrada del original) y "modern" (sintetizados con Web Audio).
// Ambos exponen la misma interfaz: start, serve, hit(intensidad 0..1), wall, goal, level, win.
window.PongAudio = (() => {
  'use strict';

  let ac = null, master = null, noiseBuffer = null;
  let muted = false;

  function context() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      // Compresor suave para que los sonidos superpuestos no saturen
      const comp = ac.createDynamicsCompressor();
      master = ac.createGain();
      master.gain.value = 0.6;
      master.connect(comp).connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  // Envuelve cada sonido: respeta el silencio y nunca rompe el juego si el audio falla
  const sound = (fn) => (...args) => {
    if (muted) return;
    try { fn(...args); } catch (_) { /* sin audio */ }
  };

  function tone({ type = 'sine', f0, f1 = f0, dur, vol = 0.2, at = 0, attack = 0.005 }) {
    const a = context();
    const t = a.currentTime + at;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise({ dur, vol = 0.2, filter = 'bandpass', f0 = 1000, f1 = f0, q = 1, at = 0, attack = 0.005 }) {
    const a = context();
    if (!noiseBuffer) {
      noiseBuffer = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const t = a.currentTime + at;
    const src = a.createBufferSource();
    const biquad = a.createBiquadFilter();
    const gain = a.createGain();
    src.buffer = noiseBuffer;
    biquad.type = filter;
    biquad.Q.value = q;
    biquad.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) biquad.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(biquad).connect(gain).connect(master);
    src.start(t, Math.random() * Math.max(0, 1.95 - dur));
    src.stop(t + dur + 0.02);
  }

  const beep = (freq, dur, at = 0) => tone({ type: 'square', f0: freq, dur, vol: 0.12, at, attack: 0.001 });

  const classic = {
    start: sound(() => beep(660, 0.08)),
    serve: () => {},
    hit: sound(() => beep(459, 0.04)),
    wall: sound(() => beep(226, 0.04)),
    goal: sound(() => beep(490, 0.25)),
    level: sound(() => beep(880, 0.12, 0.28)),
    win: () => {},
  };

  const note = (n) => 440 * Math.pow(2, (n - 69) / 12); // número MIDI -> Hz

  const modern = {
    start: sound(() => {
      [72, 76, 79].forEach((n, i) => tone({ type: 'triangle', f0: note(n), dur: 0.22, vol: 0.18, at: i * 0.07 }));
    }),
    // Silbido de la pelota al ponerse en juego
    serve: sound(() => noise({ dur: 0.3, vol: 0.1, filter: 'bandpass', f0: 500, f1: 2400, q: 3, attack: 0.08 })),
    // Golpe seco: chasquido + cuerpo tonal (más agudo cuanto más rápida va la pelota) + subgrave
    hit: sound((intensity = 0) => {
      noise({ dur: 0.035, vol: 0.18, filter: 'highpass', f0: 3500 });
      tone({ type: 'triangle', f0: 480 + 420 * intensity, f1: 240, dur: 0.1, vol: 0.28 });
      tone({ type: 'sine', f0: 150, f1: 70, dur: 0.12, vol: 0.3 });
    }),
    wall: sound(() => {
      noise({ dur: 0.05, vol: 0.1, filter: 'lowpass', f0: 900 });
      tone({ type: 'sine', f0: 320, f1: 190, dur: 0.08, vol: 0.16 });
    }),
    // Explosión grave (onda expansiva) + ovación del público + arpegio de victoria
    goal: sound(() => {
      tone({ type: 'sine', f0: 140, f1: 35, dur: 0.6, vol: 0.45 });
      noise({ dur: 0.35, vol: 0.2, filter: 'lowpass', f0: 1200, f1: 150 });
      noise({ dur: 1.6, vol: 0.16, filter: 'bandpass', f0: 700, f1: 1300, q: 0.6, attack: 0.25, at: 0.05 });
      [72, 76, 79, 84].forEach((n, i) => tone({ type: 'square', f0: note(n), dur: 0.16, vol: 0.07, at: 0.1 + i * 0.08 }));
    }),
    level: sound(() => {
      [76, 79, 83, 88].forEach((n, i) => {
        tone({ type: 'triangle', f0: note(n), dur: 0.2, vol: 0.18, at: 0.35 + i * 0.07 });
        tone({ type: 'sine', f0: note(n + 12), dur: 0.15, vol: 0.06, at: 0.35 + i * 0.07 });
      });
    }),
    // Pequeña fanfarria
    win: sound(() => {
      const melody = [[67, 0, 0.15], [72, 0.15, 0.15], [76, 0.3, 0.15], [79, 0.45, 0.3], [76, 0.78, 0.15], [79, 0.93, 0.6]];
      for (const [n, at, dur] of melody) {
        tone({ type: 'square', f0: note(n), dur, vol: 0.09, at });
        tone({ type: 'triangle', f0: note(n - 12), dur, vol: 0.14, at });
      }
    }),
  };

  return {
    classic,
    modern,
    setMuted(value) { muted = value; },
  };
})();
