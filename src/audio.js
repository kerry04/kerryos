// All sound is synthesized in the browser: a Karplus-Strong plucked-string
// guitar, an original drum-and-bass groove for dancing, and physical-ish SFX.
// Sources are positioned in the room and the listener follows the camera.

import { ASSETS } from './config.js';

export function createAudio() {
  let ctx = null, master, comp, reverb, revSend, listener, enabled = false, muted = false;
  const noteCache = new Map();
  let noiseBuf = null;
  let ambience = null, crowd = null, crickets = null;

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3;
    master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp); comp.connect(ctx.destination);
    reverb = ctx.createConvolver(); reverb.buffer = makeIR(1.7);
    revSend = ctx.createGain(); revSend.gain.value = 0.22;
    revSend.connect(reverb); reverb.connect(master);
    listener = ctx.listener;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    enabled = true;
    startAmbience();
  }

  function makeIR(sec) {
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 200 ? i / 200 : 1);
      }
    }
    return b;
  }

  // positional voice: returns the input node to connect a source into
  function voice(pos, { gain = 1, send = 0.2, ref = 1.2 } = {}) {
    const g = ctx.createGain(); g.gain.value = gain;
    let out = g;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1.1;
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      g.connect(p); out = p;
    }
    out.connect(master);
    if (send > 0) { const s = ctx.createGain(); s.gain.value = send; out.connect(s); s.connect(revSend); }
    return g;
  }

  function setListener(cam) {
    if (!ctx) return;
    const p = cam.position, m = cam.matrixWorld.elements;
    const t = ctx.currentTime;
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(p.x, t, 0.05); listener.positionY.setTargetAtTime(p.y, t, 0.05); listener.positionZ.setTargetAtTime(p.z, t, 0.05);
      listener.forwardX.setTargetAtTime(-m[8], t, 0.05); listener.forwardY.setTargetAtTime(-m[9], t, 0.05); listener.forwardZ.setTargetAtTime(-m[10], t, 0.05);
      listener.upX.setTargetAtTime(m[4], t, 0.05); listener.upY.setTargetAtTime(m[5], t, 0.05); listener.upZ.setTargetAtTime(m[6], t, 0.05);
    } else listener.setPosition(p.x, p.y, p.z);
  }

  // ------------------------------------------------------------ guitar
  function ksBuffer(midi) {
    if (noteCache.has(midi)) return noteCache.get(midi);
    const sr = ctx.sampleRate, f = 440 * Math.pow(2, (midi - 69) / 12);
    const len = Math.floor(sr * 3.2);
    const buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    const N = Math.max(2, Math.round(sr / f));
    const ring = new Float32Array(N);
    // pick excitation: noise, low-passed, with a comb for pick position
    let prev = 0;
    for (let i = 0; i < N; i++) { const n = Math.random() * 2 - 1; prev = prev * 0.55 + n * 0.45; ring[i] = prev; }
    const pickPos = Math.floor(N * 0.18);
    const ex = ring.slice();
    for (let i = 0; i < N; i++) ring[i] = ex[i] - ex[(i + pickPos) % N] * 0.6;
    const decay = 0.9965 - Math.min(0.004, (f - 80) / 200000);
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const a = ring[idx], b = ring[(idx + 1) % N];
      out[i] = a;
      ring[idx] = decay * (a * 0.5 + b * 0.5);
      idx = (idx + 1) % N;
    }
    // soft attack de-click
    for (let i = 0; i < 64; i++) out[i] *= i / 64;
    noteCache.set(midi, buf);
    return buf;
  }

  let guitarBus = null;
  function guitarOut(pos) {
    if (!guitarBus) {
      guitarBus = ctx.createGain(); guitarBus.gain.value = 0.85;
      const body1 = ctx.createBiquadFilter(); body1.type = 'peaking'; body1.frequency.value = 105; body1.Q.value = 2; body1.gain.value = 5;
      const body2 = ctx.createBiquadFilter(); body2.type = 'peaking'; body2.frequency.value = 230; body2.Q.value = 1.5; body2.gain.value = 3;
      const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 4500; shelf.gain.value = -7;
      guitarBus.connect(body1); body1.connect(body2); body2.connect(shelf);
      guitarBus._out = shelf; guitarBus._pos = null;
    }
    if (pos) {
      if (guitarBus._panner) guitarBus._out.disconnect();
      const v = voice(pos, { gain: 1, send: 0.28 });
      guitarBus._out.connect(v);
      guitarBus._panner = v;
    }
    return guitarBus;
  }

  function pluck(midi, when, gain = 0.5) {
    if (!enabled) return;
    const src = ctx.createBufferSource();
    src.buffer = ksBuffer(midi);
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(guitarOut());
    const t = ctx.currentTime + Math.max(0, when);
    src.start(t);
    src.stop(t + 3.2);
  }

  // ------------------------------------------------------------ SFX helpers
  function noiseBurst(pos, { dur = 0.08, freq = 1200, q = 1, type = 'bandpass', gain = 0.4, when = 0, send = 0.1, attack = 0.002 }) {
    if (!enabled) return;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime + when;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(voice(pos, { send }));
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }
  function tone(pos, { freq = 200, end = null, dur = 0.2, type = 'sine', gain = 0.4, when = 0, send = 0.15 }) {
    if (!enabled) return;
    const o = ctx.createOscillator(); o.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime + when;
    o.frequency.setValueAtTime(freq, t);
    if (end) o.frequency.exponentialRampToValueAtTime(end, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(voice(pos, { send }));
    o.start(t); o.stop(t + dur + 0.05);
  }

  const sfx = {
    bounce(speed, pos, kind = 'floor') {
      const v = Math.min(1, speed / 6);
      if (kind === 'soft') { noiseBurst(pos, { dur: 0.09, freq: 300, type: 'lowpass', gain: 0.2 * v }); return; }
      tone(pos, { freq: 140 + v * 30, end: 70, dur: 0.12, gain: 0.55 * v, send: 0.12 });
      noiseBurst(pos, { dur: 0.05, freq: 900, q: 0.8, gain: 0.25 * v, send: 0.08 });
      // the hollow ring of a basketball
      tone(pos, { freq: 520 + Math.random() * 40, dur: 0.18, gain: 0.05 * v, send: 0.2 });
    },
    rim(speed, pos) {
      const v = Math.min(1, speed / 5);
      [620, 1370, 2210, 3400].forEach((f, i) => tone(pos, { freq: f * (1 + Math.random() * 0.01), dur: 0.45 - i * 0.08, gain: (0.18 / (i + 1)) * v, type: 'triangle', send: 0.25 }));
      noiseBurst(pos, { dur: 0.03, freq: 3000, gain: 0.15 * v });
    },
    board(speed, pos) {
      const v = Math.min(1, speed / 5);
      tone(pos, { freq: 110, end: 80, dur: 0.14, gain: 0.5 * v });
      noiseBurst(pos, { dur: 0.07, freq: 500, gain: 0.25 * v });
    },
    swish(pos) {
      noiseBurst(pos, { dur: 0.32, freq: 2600, q: 0.6, type: 'bandpass', gain: 0.22, attack: 0.04, send: 0.15 });
    },
    step(pos, soft = false) { noiseBurst(pos, { dur: 0.06, freq: soft ? 260 : 380, type: 'lowpass', gain: soft ? 0.05 : 0.09, send: 0.05 }); tone(pos, { freq: 70, dur: 0.05, gain: 0.05 }); },
    key(pos) { noiseBurst(pos, { dur: 0.025, freq: 3500 + Math.random() * 1500, q: 2, gain: 0.08, send: 0.03 }); tone(pos, { freq: 1800 + Math.random() * 400, dur: 0.02, gain: 0.02 }); },
    pad(pos) { noiseBurst(pos, { dur: 0.02, freq: 2500, q: 3, gain: 0.04, send: 0.02 }); },
    whistle(pos) { tone(pos, { freq: 2600, dur: 0.6, gain: 0.07, type: 'sine', send: 0.2 }); tone(pos, { freq: 2650, dur: 0.6, gain: 0.05, type: 'square', send: 0.1 }); },
    cheer(pos) { noiseBurst(pos, { dur: 2.2, freq: 900, q: 0.5, gain: 0.18, attack: 0.25, send: 0.3 }); },
    yawn(pos) { tone(pos, { freq: 230, end: 150, dur: 1.1, type: 'sawtooth', gain: 0.02, send: 0.3 }); },
    chair(pos) { tone(pos, { freq: 900, end: 600, dur: 0.25, type: 'triangle', gain: 0.02, send: 0.1 }); },
  };

  // ------------------------------------------------------------ ambience
  function startAmbience() {
    // room tone
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180;
    const g = ctx.createGain(); g.gain.value = 0.02;
    src.connect(f); f.connect(g); g.connect(master); src.start();
    ambience = g;
    // crowd bed for the TV (gain driven from outside)
    const c = ctx.createBufferSource(); c.buffer = noiseBuf; c.loop = true;
    const cf = ctx.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 700; cf.Q.value = 0.4;
    const cg = ctx.createGain(); cg.gain.value = 0;
    c.connect(cf); cf.connect(cg); crowd = { gain: cg, node: null };
    c.start();
    crickets = { gain: ctx.createGain(), next: 0 };
    crickets.gain.gain.value = 0; crickets.gain.connect(master);
  }
  let crowdPos = null;
  function setCrowd(level, pos) {
    if (!enabled || !crowd) return;
    if (!crowd.node && pos) { crowd.node = voice(pos, { send: 0.25 }); crowd.gain.connect(crowd.node); }
    crowd.gain.gain.setTargetAtTime(level * 0.07, ctx.currentTime, 0.4);
  }
  function tickCrickets(night, windowPos) {
    if (!enabled || !crickets) return;
    crickets.gain.gain.setTargetAtTime(night * 0.05, ctx.currentTime, 1);
    if (night < 0.3) return;
    if (ctx.currentTime > crickets.next) {
      crickets.next = ctx.currentTime + 0.6 + Math.random() * 1.6;
      const base = 4200 + Math.random() * 400;
      for (let i = 0; i < 3; i++) {
        const o = ctx.createOscillator(); o.frequency.value = base;
        const g = ctx.createGain();
        const t = ctx.currentTime + i * 0.07;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.4, t + 0.01); g.gain.linearRampToValueAtTime(0, t + 0.05);
        o.connect(g); g.connect(crickets.gain); o.start(t); o.stop(t + 0.06);
      }
    }
  }

  // ------------------------------------------------------------ groove for dancing (118 bpm)
  const groove = { on: false, step: 0, nextTime: 0, pos: null, onBeat: null, sinceStart: 0 };
  const BPM = 118, STEP = 60 / BPM / 4;
  const bassline = [45, null, 45, null, 48, null, null, 50, 45, null, 45, null, 43, null, 45, null];
  const marimba = [69, null, 72, null, null, 74, null, 72, 69, null, 67, null, 69, null, null, null];
  function drum(type, t, pos) {
    if (type === 'kick') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g); g.connect(voice(pos, { send: 0.05, gain: 0.9 })); o.start(t); o.stop(t + 0.4);
    } else if (type === 'hat' || type === 'shaker') {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = type === 'hat' ? 7000 : 5000;
      const g = ctx.createGain(); g.gain.setValueAtTime(type === 'hat' ? 0.16 : 0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + (type === 'hat' ? 0.05 : 0.09));
      s.connect(f); f.connect(g); g.connect(voice(pos, { send: 0.1 })); s.start(t, Math.random()); s.stop(t + 0.12);
    } else if (type === 'clap') {
      for (let i = 0; i < 3; i++) {
        const s = ctx.createBufferSource(); s.buffer = noiseBuf;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.8;
        const g = ctx.createGain(); const tt = t + i * 0.012;
        g.gain.setValueAtTime(0.35, tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.12);
        s.connect(f); f.connect(g); g.connect(voice(pos, { send: 0.35 })); s.start(tt, Math.random()); s.stop(tt + 0.15);
      }
    } else if (type === 'conga') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.08);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g); g.connect(voice(pos, { send: 0.15 })); o.start(t); o.stop(t + 0.2);
    }
  }
  function synthNote(midi, t, dur, pos, kind) {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const o = ctx.createOscillator(), g = ctx.createGain();
    if (kind === 'bass') {
      o.type = 'sawtooth';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(600, t); lp.frequency.exponentialRampToValueAtTime(160, t + dur);
      o.frequency.value = f / 2;
      g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.3, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(lp); lp.connect(g);
    } else {
      o.type = 'sine'; o.frequency.value = f;
      const o2 = ctx.createOscillator(); o2.frequency.value = f * 4; const g2 = ctx.createGain(); g2.gain.value = 0.25;
      o2.connect(g2); g2.connect(g); o2.start(t); o2.stop(t + dur);
      g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g);
    }
    g.connect(voice(pos, { send: kind === 'bass' ? 0.05 : 0.3 }));
    o.start(t); o.stop(t + dur + 0.02);
  }
  function scheduleGroove() {
    if (!groove.on || !enabled) return;
    while (groove.nextTime < ctx.currentTime + 0.15) {
      const s = groove.step % 16, bar = Math.floor(groove.step / 16);
      const t = groove.nextTime, p = groove.pos;
      if (s % 4 === 0) drum('kick', t, p);
      if (s === 4 || s === 12) drum('clap', t, p);
      if (s % 2 === 1) drum('hat', t, p);
      drum('shaker', t, p);
      if ([3, 6, 10, 11, 14].includes(s)) drum('conga', t, p);
      if (bassline[s]) synthNote(bassline[s] + (bar % 4 === 3 ? -2 : 0), t, STEP * 1.8, p, 'bass');
      if (bar % 2 === 1 && marimba[s]) synthNote(marimba[s], t, 0.3, p, 'mallet');
      const stepNo = groove.step;
      setTimeout(() => groove.onBeat?.(stepNo % 16), Math.max(0, (t - ctx.currentTime) * 1000));
      groove.nextTime += STEP;
      groove.step++;
    }
  }

  return {
    init, get enabled() { return enabled && !muted; }, get ctx() { return ctx; },
    setMuted(m) { muted = m; if (ctx) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05); },
    get muted() { return muted; },
    setListener, pluck, sfx: new Proxy(sfx, { get: (o, k) => (...a) => { if (enabled && !muted) o[k](...a); } }),
    setGuitarPos(pos) { if (enabled) guitarOut(pos); },
    setCrowd, tickCrickets,
    startGroove(pos, onBeat) { if (!enabled) { groove.on = true; groove.onBeat = onBeat; groove.pos = pos; return; } groove.on = true; groove.pos = pos; groove.onBeat = onBeat; groove.step = 0; groove.nextTime = ctx.currentTime + 0.1; },
    stopGroove() { groove.on = false; },
    get grooveOn() { return groove.on; },
    update() { if (groove.on && enabled && groove.nextTime < ctx.currentTime) { /* catch up after resume */ groove.nextTime = Math.max(groove.nextTime, ctx.currentTime); } scheduleGroove(); },
    BPM,
    voiceClip(name) { const a = new Audio(ASSETS.audio(name)); a.preload = 'auto'; return a; },
  };
}
