import * as THREE from 'three';
import { canvas, canvasTexture, clamp, rand, pick } from './util.js';

// ------------------------------------------------------------------ TV
// An original top-down football match. Kerry's side wears sky blue. When he is
// holding the controller his side plays sharper; goals fire callbacks so he can
// react. When he is dancing the TV shows an audio visualiser; otherwise off.
export function createTV(screenMesh) {
  const W = 640, H = 360;
  const [c, x] = canvas(W, H);
  const tex = canvasTexture(c, { aniso: 4 });
  screenMesh.material.map = tex; screenMesh.material.color.set('#ffffff'); screenMesh.material.needsUpdate = true;
  const mode = { value: 'off' }; // off | game | viz | home
  const pitch = { x: 40, y: 40, w: W - 80, h: H - 80 };
  const ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
  const mkTeam = (side, col) => Array.from({ length: 5 }, (_, i) => ({
    side, col, x: side < 0 ? W * 0.3 : W * 0.7, y: 80 + i * 50, hx: side < 0 ? (i === 0 ? 60 : W * (0.2 + (i % 2) * 0.15)) : (i === 0 ? W - 60 : W * (0.8 - (i % 2) * 0.15)), hy: 70 + i * 55, gk: i === 0,
  }));
  const blue = mkTeam(-1, '#8cc3ef'), red = mkTeam(1, '#8f2335');
  const score = [0, 0];
  let clock = 0, kickoffT = 0, goalFlash = 0, onGoal = null, skill = 0.6, inputs = 0;
  let avg = new THREE.Color('#000000');
  let vizBars = new Float32Array(32), vizEnergy = 0;

  function kickoff() { ball.x = W / 2; ball.y = H / 2; ball.vx = ball.vy = 0; kickoffT = 1.2; for (const p of [...blue, ...red]) { p.x = p.hx; p.y = p.hy; } }
  kickoff();

  function stepGame(dt) {
    clock += dt * 18; // a 90-minute match in ~5 minutes
    if (clock > 90 * 60) { clock = 0; score[0] = score[1] = 0; }
    if (kickoffT > 0) { kickoffT -= dt; return; }
    for (const team of [blue, red]) {
      const attackDir = team === blue ? 1 : -1;
      const sharp = team === blue ? skill : 0.55;
      // the nearest outfield player chases; others hold shape
      let nearest = null, nd = 1e9;
      for (const p of team) { if (p.gk) continue; const d = Math.hypot(p.x - ball.x, p.y - ball.y); if (d < nd) { nd = d; nearest = p; } }
      for (const p of team) {
        let tx, ty;
        if (p === nearest) { tx = ball.x - attackDir * 6; ty = ball.y; }
        else if (p.gk) { tx = p.hx; ty = clamp(ball.y, H / 2 - 40, H / 2 + 40); }
        else { tx = p.hx + (ball.x - W / 2) * 0.45; ty = p.hy + (ball.y - p.hy) * 0.3; }
        const sp = (p === nearest ? 95 : 60) * (0.8 + sharp * 0.4);
        const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
        p.x += (dx / d) * Math.min(d, sp * dt); p.y += (dy / d) * Math.min(d, sp * dt);
        // touch the ball
        if (Math.hypot(p.x - ball.x, p.y - ball.y) < 9) {
          const goalX = attackDir > 0 ? pitch.x + pitch.w : pitch.x;
          const aimY = H / 2 + rand(-30, 30);
          const ax = goalX - ball.x, ay = aimY - ball.y, ad = Math.hypot(ax, ay);
          const power = (Math.random() < 0.25 + sharp * 0.2 ? 330 : 180) * (0.85 + sharp * 0.3);
          ball.vx = (ax / ad) * power + rand(-40, 40); ball.vy = (ay / ad) * power + rand(-60, 60);
        }
      }
    }
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    ball.vx *= Math.exp(-1.6 * dt); ball.vy *= Math.exp(-1.6 * dt);
    if (ball.y < pitch.y || ball.y > pitch.y + pitch.h) { ball.vy *= -0.8; ball.y = clamp(ball.y, pitch.y, pitch.y + pitch.h); }
    const inGoalMouth = Math.abs(ball.y - H / 2) < 34;
    if (ball.x < pitch.x || ball.x > pitch.x + pitch.w) {
      if (inGoalMouth) {
        const blueScored = ball.x > pitch.x + pitch.w;
        score[blueScored ? 0 : 1]++;
        goalFlash = 2.2;
        onGoal?.(blueScored);
        kickoff();
      } else { ball.vx *= -0.7; ball.x = clamp(ball.x, pitch.x, pitch.x + pitch.w); }
    }
  }

  function drawGame() {
    // grass with mowing stripes
    for (let i = 0; i < 12; i++) { x.fillStyle = i % 2 ? '#2f7a3a' : '#2b7036'; x.fillRect(i * (W / 12), 0, W / 12 + 1, H); }
    x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = 2;
    x.strokeRect(pitch.x, pitch.y, pitch.w, pitch.h);
    x.beginPath(); x.moveTo(W / 2, pitch.y); x.lineTo(W / 2, pitch.y + pitch.h); x.stroke();
    x.beginPath(); x.arc(W / 2, H / 2, 40, 0, Math.PI * 2); x.stroke();
    x.strokeRect(pitch.x, H / 2 - 70, 70, 140); x.strokeRect(pitch.x + pitch.w - 70, H / 2 - 70, 70, 140);
    x.fillStyle = 'rgba(255,255,255,0.9)'; x.fillRect(pitch.x - 6, H / 2 - 34, 6, 68); x.fillRect(pitch.x + pitch.w, H / 2 - 34, 6, 68);
    for (const p of [...blue, ...red]) {
      x.fillStyle = 'rgba(0,0,0,0.25)'; x.beginPath(); x.ellipse(p.x + 2, p.y + 3, 7, 4, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = p.gk ? (p.side < 0 ? '#e7d24a' : '#2a2a2a') : p.col; x.beginPath(); x.arc(p.x, p.y, 7, 0, Math.PI * 2); x.fill();
    }
    x.fillStyle = '#fff'; x.beginPath(); x.arc(ball.x, ball.y, 4, 0, Math.PI * 2); x.fill();
    // scoreboard
    x.fillStyle = 'rgba(10,14,20,0.85)'; x.fillRect(16, 10, 196, 26);
    x.font = '600 15px "IBM Plex Mono", monospace'; x.fillStyle = '#8cc3ef'; x.fillText('KER', 24, 28);
    x.fillStyle = '#fff'; x.fillText(`${score[0]} - ${score[1]}`, 66, 28);
    x.fillStyle = '#d3707f'; x.fillText('CPU', 122, 28);
    const mins = Math.floor(clock / 60);
    x.fillStyle = '#c9ced6'; x.fillText(`${String(mins).padStart(2, '0')}'`, 166, 28);
    if (goalFlash > 0) {
      x.fillStyle = `rgba(0,0,0,${0.35 * Math.min(1, goalFlash)})`; x.fillRect(0, H / 2 - 40, W, 80);
      x.font = '900 54px Archivo, sans-serif'; x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.fillText('GOAL', W / 2, H / 2 + 19); x.textAlign = 'left';
    }
  }

  function drawViz(dt) {
    x.fillStyle = '#07080b'; x.fillRect(0, 0, W, H);
    for (let i = 0; i < vizBars.length; i++) {
      const target = Math.max(0.04, vizEnergy * (0.5 + 0.5 * Math.sin(i * 0.7 + performance.now() / 300)) * (1 - i / 48));
      vizBars[i] += (target - vizBars[i]) * Math.min(1, dt * 12);
      const bh = vizBars[i] * H * 0.7;
      x.fillStyle = `hsl(${200 + i * 2}, 70%, ${45 + vizBars[i] * 25}%)`;
      x.fillRect(40 + i * ((W - 80) / vizBars.length), H - 40 - bh, (W - 80) / vizBars.length - 4, bh);
    }
    x.font = '600 14px "IBM Plex Mono", monospace'; x.fillStyle = 'rgba(255,255,255,0.6)'; x.fillText('NOW PLAYING  ·  room mix', 40, 40);
  }

  let acc = 0;
  function update(dt) {
    if (mode.value === 'off') {
      if (screenMesh.material.color.r > 0.02) { x.fillStyle = '#000'; x.fillRect(0, 0, W, H); tex.needsUpdate = true; screenMesh.material.color.set('#000000'); avg.set(0, 0, 0); }
      return;
    }
    screenMesh.material.color.set('#ffffff');
    if (mode.value === 'game') stepGame(dt);
    goalFlash = Math.max(0, goalFlash - dt);
    acc += dt;
    if (acc < 1 / 24) return;
    const step = acc; acc = 0;
    if (mode.value === 'game') { drawGame(); avg.setRGB(0.18, 0.42, 0.22); }
    else if (mode.value === 'viz') { drawViz(step); avg.setRGB(0.12, 0.2, 0.4).multiplyScalar(0.5 + vizEnergy); }
    tex.needsUpdate = true;
  }
  return {
    update, avg, score,
    set mode(v) { mode.value = v; }, get mode() { return mode.value; },
    set onGoal(f) { onGoal = f; },
    set skill(v) { skill = v; },
    set energy(v) { vizEnergy = v; },
    input() { inputs++; },
  };
}

// ------------------------------------------------------------------ cyberdeck terminal (Jarvis shell)
export function createDeckScreen(mesh) {
  const W = 512, H = 306;
  const [c, x] = canvas(W, H);
  const tex = canvasTexture(c, { aniso: 4 });
  mesh.material.map = tex; mesh.material.needsUpdate = true;
  const script = [
    ['$ ', 'jarvis brief'],
    ['', 'inbox     14 new · 3 want a reply · 2 drafts ready'],
    ['', 'calendar  Soko AI review, Thu 14:00'],
    ['', 'waiting   2 actions need your one-tap approval'],
    ['$ ', 'jarvis drafts --show 1'],
    ['', 're: chart spec — "Sending the YES/NO bar mock tonight."'],
    ['', '[approve] [edit] [discard]   (nothing sends without you)'],
    ['$ ', 'kerryos status'],
    ['', 'broker    up · sessions 1/1 · queue 0'],
    ['', 'egress    allowlist enforced · blocked 0 in 24h'],
    ['$ ', 'git -C ~/soko log --oneline -3'],
    ['', 'a91c2e4 market page: live headlines reel'],
    ['', '7d03b11 news: on-site article reader'],
    ['', '52e8f0a charts: YES/NO bars on one 0-100 scale'],
    ['$ ', 'make test'],
    ['', '✓ 214 passed  (12.8s)'],
  ];
  // the screen keeps the last session's output between uses
  let line = 0, ch = 0, history = script.map(([p, t]) => [p, t]), cursor = 0, idleT = 0;
  function render() {
    x.fillStyle = '#0b0d0c'; x.fillRect(0, 0, W, H);
    x.font = '500 15px "IBM Plex Mono", monospace';
    const lh = 19;
    const shown = [...history];
    if (line < script.length) shown.push([script[line][0], script[line][1].slice(0, ch), true]);
    const start = Math.max(0, shown.length - 14);
    shown.slice(start).forEach(([p, t, live], i) => {
      x.fillStyle = p ? '#e9b44c' : '#9fb3a4';
      x.fillText(p, 12, 26 + i * lh);
      x.fillStyle = p ? '#e7e3d6' : '#8fa597';
      x.fillText(t, 12 + (p ? 18 : 0), 26 + i * lh);
      if (live && Math.floor(cursor * 2) % 2 === 0) {
        const w = x.measureText(t).width;
        x.fillStyle = '#e9b44c'; x.fillRect(12 + (p ? 18 : 0) + w + 2, 13 + i * lh, 8, 15);
      }
    });
    // subtle scanline
    x.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < H; y += 3) x.fillRect(0, y, W, 1);
    tex.needsUpdate = true;
  }
  render();
  let acc = 0;
  return {
    // returns true when a key was "pressed" this frame
    update(dt, active) {
      cursor += dt;
      acc += dt;
      let pressed = false;
      if (active) {
        const cur = script[line];
        if (!cur) { history.push(['$ ', 'clear']); history = []; line = 0; ch = 0; }
        else if (cur[0] === '') { // output appears instantly after a short pause
          idleT += dt;
          if (idleT > 0.35) { history.push([cur[0], cur[1]]); line++; ch = 0; idleT = 0; }
        } else if (ch < cur[1].length) {
          if (acc > 0.05 + Math.random() * 0.09) { ch++; acc = 0; pressed = true; }
        } else {
          idleT += dt;
          if (idleT > 0.5) { history.push([cur[0], cur[1]]); line++; ch = 0; idleT = 0; pressed = true; }
        }
      }
      if (acc > 1 / 20 || pressed) render();
      return pressed;
    },
  };
}

// ------------------------------------------------------------------ Soko Stock globe (portrait)
export function createStockScreen(mesh) {
  const W = 360, H = 624;
  const [c, x] = canvas(W, H);
  const tex = canvasTexture(c, { aniso: 4 });
  mesh.material.map = tex; mesh.material.needsUpdate = true;
  const D = Math.PI / 180;
  const dots = [];
  for (let i = 0; i < 500; i++) { const y = 1 - (i / 499) * 2, r = Math.sqrt(1 - y * y), t = i * 2.39996; dots.push([Math.cos(t) * r, y, Math.sin(t) * r]); }
  const cities = [[6.5, 3.4], [30, 31.2], [-26.2, 28], [25.2, 55.3], [19, 72.9], [51.5, -0.1], [1.35, 103.8], [40.7, -74]];
  const origin = [-1.29, 36.82];
  const vec = (la, lo) => [Math.cos(la * D) * Math.cos(lo * D), Math.sin(la * D), Math.cos(la * D) * Math.sin(lo * D)];
  const markets = [['Fuel prices up in Nov?', 0.62], ['Rate cut at next MPC?', 0.41], ['Harambee Stars win?', 0.37], ['KES under 130/$?', 0.55], ['Rain above avg in Nbi?', 0.68]];
  let rot = -origin[1] * D, t = 0, acc = 0;
  function proj(p) {
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const xx = p[0] * cr - p[2] * sr, zz = p[0] * sr + p[2] * cr;
    const tilt = 0.25, ct = Math.cos(tilt), st = Math.sin(tilt);
    const yy = p[1] * ct - zz * st, z2 = p[1] * st + zz * ct;
    return [W / 2 + xx * 130, 200 - yy * 130, z2];
  }
  function render() {
    x.fillStyle = '#0b1013'; x.fillRect(0, 0, W, H);
    x.font = '600 13px "IBM Plex Mono", monospace'; x.fillStyle = '#e9b44c'; x.fillText('SOKO STOCK', 16, 26);
    x.fillStyle = '#6f8188'; x.fillText('signal map · origin NBO', 16, 44);
    x.strokeStyle = 'rgba(120,140,150,0.35)'; x.beginPath(); x.arc(W / 2, 200, 130, 0, Math.PI * 2); x.stroke();
    for (const d of dots) { const p = proj(d); if (p[2] < 0) continue; x.fillStyle = `rgba(150,170,175,${0.15 + p[2] * 0.5})`; x.fillRect(p[0], p[1], 1.6, 1.6); }
    const o = vec(...origin);
    cities.forEach((cty, k) => {
      const v = vec(...cty);
      x.strokeStyle = 'rgba(233,180,76,0.5)'; x.beginPath();
      let started = false;
      for (let i = 0; i <= 24; i++) {
        const s = i / 24, lift = 1 + Math.sin(s * Math.PI) * 0.15;
        const pp = [(o[0] * (1 - s) + v[0] * s), (o[1] * (1 - s) + v[1] * s), (o[2] * (1 - s) + v[2] * s)];
        const l = Math.hypot(...pp) || 1;
        const q = proj(pp.map((a) => (a / l) * lift));
        if (q[2] < -0.1) { started = false; continue; }
        if (!started) { x.moveTo(q[0], q[1]); started = true; } else x.lineTo(q[0], q[1]);
      }
      x.stroke();
      const s = ((t * 0.3 + k / cities.length) % 1);
      const pp = [(o[0] * (1 - s) + v[0] * s), (o[1] * (1 - s) + v[1] * s), (o[2] * (1 - s) + v[2] * s)];
      const l = Math.hypot(...pp) || 1;
      const q = proj(pp.map((a) => (a / l) * (1 + Math.sin(s * Math.PI) * 0.15)));
      if (q[2] > -0.1) { x.fillStyle = '#e9b44c'; x.fillRect(q[0] - 2, q[1] - 2, 4, 4); }
    });
    const op = proj(o);
    if (op[2] > 0) { x.fillStyle = '#e9b44c'; x.beginPath(); x.arc(op[0], op[1], 4, 0, Math.PI * 2); x.fill(); }
    // market list
    x.strokeStyle = '#1f2a2f'; x.beginPath(); x.moveTo(16, 360); x.lineTo(W - 16, 360); x.stroke();
    markets.forEach(([q, p], i) => {
      const y = 392 + i * 46;
      const pp = clamp(p + Math.sin(t * 0.7 + i * 2) * 0.03, 0.02, 0.98);
      x.fillStyle = '#c7cfd2'; x.font = '500 13px "IBM Plex Mono", monospace'; x.fillText(q, 16, y);
      x.fillStyle = '#16221f'; x.fillRect(16, y + 9, W - 32, 8);
      x.fillStyle = '#4fd1a5'; x.fillRect(16, y + 9, (W - 32) * pp, 8);
      x.fillStyle = '#4fd1a5'; x.textAlign = 'right'; x.fillText(Math.round(pp * 100) + '¢', W - 16, y); x.textAlign = 'left';
    });
    tex.needsUpdate = true;
  }
  return {
    update(dt) { t += dt; rot += dt * 0.12; acc += dt; if (acc > 1 / 15) { acc = 0; render(); } },
  };
}

// ------------------------------------------------------------------ rack OLED
export function createOled(mesh) {
  const [c, x] = canvas(256, 92);
  const tex = canvasTexture(c, { aniso: 2 });
  mesh.material.map = tex; mesh.material.needsUpdate = true;
  let t = 0, acc = 0;
  return {
    update(dt, busy = 0) {
      t += dt; acc += dt;
      if (acc < 0.5) return; acc = 0;
      x.fillStyle = '#000'; x.fillRect(0, 0, 256, 92);
      x.fillStyle = '#7fe0ff'; x.font = '600 20px "IBM Plex Mono", monospace';
      x.fillText('brain67', 10, 26);
      x.font = '500 16px "IBM Plex Mono", monospace';
      const cpu = Math.round(18 + busy * 40 + Math.sin(t) * 6 + Math.random() * 4);
      x.fillText(`sess 1/1  cpu ${cpu}%`, 10, 52);
      x.fillText(`egress ok  up 6d`, 10, 76);
      tex.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------ whiteboard (handwritten, revealed as Kerry writes)
export function createWhiteboard(mesh) {
  const W = 1500, H = 1000;
  const [c, x] = canvas(W, H);
  const tex = canvasTexture(c, { aniso: 8 });
  mesh.material.map = tex; mesh.material.needsUpdate = true;
  const hand = '"Caveat", "Segoe Print", "Bradley Hand", cursive';
  // items: [type, color, args, approx board-uv end point for the hand]
  const items = [
    ['text', '#1d4ed8', ['LMSR', 70, 110, 64], [0.18, 0.11]],
    ['text', '#111', ['C(q) = b · ln Σ exp(qᵢ / b)', 70, 200, 52], [0.45, 0.2]],
    ['text', '#111', ['pᵢ = exp(qᵢ/b) / Σ exp(qⱼ/b)', 70, 280, 52], [0.45, 0.28]],
    ['text', '#b91c1c', ['b = 750  →  deeper market, smaller moves', 70, 360, 40], [0.5, 0.36]],
    ['curve', '#111', [90, 720, 560, 250], [0.42, 0.6]],
    ['text', '#1d4ed8', ['shipping', 860, 110, 60], [0.66, 0.11]],
    ['text', '#111', ['☐ market discovery', 860, 200, 46], [0.78, 0.2]],
    ['text', '#111', ['☐ market news + posts', 860, 270, 46], [0.82, 0.27]],
    ['text', '#111', ['☐ comments', 860, 340, 46], [0.7, 0.34]],
    ['text', '#111', ['☐ KerryOS: portfolio merge', 860, 410, 46], [0.84, 0.41]],
    ['text', '#111', ['☐ Jarvis: approval queue', 860, 480, 46], [0.82, 0.48]],
    ['text', '#b91c1c', ['play money only. no KYC.', 860, 600, 46], [0.82, 0.6]],
    ['text', '#111', ['calls vs Soko AI → calibration', 70, 880, 46], [0.4, 0.88]],
  ];
  let progress = items.length; // starts fully written
  function drawItem(it, frac) {
    const [type, col, a] = it;
    x.save();
    x.fillStyle = col; x.strokeStyle = col;
    if (type === 'text') {
      const [s, px, py, size] = a;
      x.font = `600 ${size}px ${hand}`;
      const w = x.measureText(s).width;
      x.beginPath(); x.rect(px - 10, py - size, (w + 20) * frac, size * 1.4); x.clip();
      x.globalAlpha = 0.92;
      x.fillText(s, px, py);
    } else if (type === 'curve') {
      const [x0, y0, w, h] = a;
      x.lineWidth = 5; x.globalAlpha = 0.9;
      x.beginPath(); x.moveTo(x0, y0); x.lineTo(x0, y0 - h); x.moveTo(x0, y0); x.lineTo(x0 + w, y0); x.stroke();
      x.beginPath();
      const n = Math.floor(60 * frac);
      for (let i = 0; i <= n; i++) { const t = i / 60; const yy = y0 - h * (1 / (1 + Math.exp(-(t - 0.5) * 10))); if (i === 0) x.moveTo(x0 + t * w, yy); else x.lineTo(x0 + t * w, yy); }
      x.stroke();
      x.font = `600 34px ${hand}`; x.fillText('price', x0 - 10, y0 - h - 14); x.fillText('shares bought', x0 + w - 190, y0 + 42);
    }
    x.restore();
  }
  function render() {
    x.fillStyle = '#fbfbf9'; x.fillRect(0, 0, W, H);
    // faint ghosting of erased marker
    x.fillStyle = 'rgba(120,130,140,0.05)';
    for (let i = 0; i < 6; i++) { x.save(); x.translate(200 + i * 210, 500 + (i % 3) * 120); x.rotate(-0.2); x.fillRect(-160, -18, 320, 36); x.restore(); }
    const whole = Math.floor(progress);
    for (let i = 0; i < items.length; i++) {
      if (i < whole) drawItem(items[i], 1);
      else if (i === whole) drawItem(items[i], progress - whole);
    }
    tex.needsUpdate = true;
  }
  render();
  document.fonts?.load(`600 48px Caveat`).then(() => render()).catch(() => {});
  return {
    get count() { return items.length; },
    erase() { progress = 0; render(); },
    // advance writing; returns board-UV of the pen tip (0..1, origin top-left)
    write(dt, speed = 0.18) {
      if (progress >= items.length) return null;
      const before = progress;
      progress = Math.min(items.length, progress + dt * speed);
      const i = Math.min(items.length - 1, Math.floor(progress));
      const it = items[i];
      const f = progress - Math.floor(progress);
      const [type, , a, end] = it;
      let u, v;
      if (type === 'text') { const [, px, py] = a; u = (px / W) + (end[0] - px / W) * f; v = (py - 20) / H; }
      else { u = 0.06 + f * 0.4; v = 0.62 - f * 0.22; }
      if (Math.floor(before * 20) !== Math.floor(progress * 20)) render();
      return { u, v };
    },
    done() { return progress >= items.length; },
  };
}

// ------------------------------------------------------------------ fallback panel for the SokoResult monitor
export function sokoPlaceholder(mesh) {
  const [c, x] = canvas(1280, 720);
  x.fillStyle = '#0d1014'; x.fillRect(0, 0, 1280, 720);
  x.fillStyle = '#e7e3d6'; x.font = '700 64px Archivo, sans-serif'; x.fillText('SokoResult', 80, 160);
  x.fillStyle = '#8b98a0'; x.font = '500 28px "IBM Plex Mono", monospace'; x.fillText('loading the live site…', 80, 220);
  const tex = canvasTexture(c);
  mesh.material.map = tex; mesh.material.color.set('#ffffff'); mesh.material.needsUpdate = true;
}
