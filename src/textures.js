import * as THREE from 'three';
import { canvas, canvasTexture, normalFromHeight, makeNoise, rand } from './util.js';

const N = makeNoise(7);
const cache = new Map();
const memo = (k, f) => (cache.has(k) ? cache.get(k) : (cache.set(k, f()), cache.get(k)));

// Woven fabric normal map (bedding, curtains, beanbag)
export function fabricNormal(scale = 1) {
  return memo('fabric' + scale, () => {
    const s = 256;
    const c = normalFromHeight((x, y) => {
      const wx = Math.sin((x / s) * Math.PI * 2 * 48) * 0.5 + 0.5;
      const wy = Math.sin((y / s) * Math.PI * 2 * 48) * 0.5 + 0.5;
      const weave = ((Math.floor(x / 2.66) + Math.floor(y / 2.66)) & 1) ? wx : wy;
      return weave * 0.35 + N.fbm(x / 22, y / 22, 3) * 0.5;
    }, s, s, 1.6);
    return canvasTexture(c, { srgb: false, repeat: [scale, scale] });
  });
}

// Soft large-scale wrinkle normal for duvet/sheets
export function wrinkleNormal() {
  return memo('wrinkle', () => {
    const s = 256;
    const c = normalFromHeight((x, y) => {
      const a = N.fbm(x / 60, y / 90, 4);
      const ridges = Math.abs(Math.sin(x / 19 + N.n2(x / 50, y / 50) * 4));
      return a * 1.2 + ridges * 0.25;
    }, s, s, 3.2);
    return canvasTexture(c, { srgb: false, repeat: [1, 1] });
  });
}

export function basketball() {
  return memo('ball', () => {
    const w = 1024, h = 512;
    const [c, x] = canvas(w, h);
    // pebbled orange leather
    const img = x.createImageData(w, h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const n = N.n2(i / 3.1, j / 3.1) * 0.5 + 0.5;
        const k = (j * w + i) * 4;
        const shade = 0.86 + n * 0.14;
        img.data[k] = 203 * shade; img.data[k + 1] = 92 * shade; img.data[k + 2] = 38 * shade; img.data[k + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    x.strokeStyle = '#1b130f'; x.lineWidth = 7; x.lineCap = 'round';
    // equator + one meridian pair
    x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke();
    x.beginPath(); x.moveTo(w * 0.25, 0); x.lineTo(w * 0.25, h); x.stroke();
    x.beginPath(); x.moveTo(w * 0.75, 0); x.lineTo(w * 0.75, h); x.stroke();
    // curved seams
    for (const off of [0, w / 2]) {
      x.beginPath();
      for (let j = 0; j <= h; j += 4) {
        const t = j / h;
        const px = off + w * 0.25 + Math.sin(t * Math.PI) * w * 0.16 * Math.sign(Math.cos(t * Math.PI));
        if (j === 0) x.moveTo(px, j); else x.lineTo(px, j);
      }
      x.stroke();
    }
    const t = canvasTexture(c);
    return t;
  });
}

export function pebbleNormal() {
  return memo('pebble', () => {
    const c = normalFromHeight((x, y) => N.n2(x / 2.2, y / 2.2) * 0.5 + 0.5, 512, 256, 2.4);
    return canvasTexture(c, { srgb: false });
  });
}

// Rug: woven wool with a quiet geometric border
export function rug() {
  return memo('rug', () => {
    const w = 1024, h = 800;
    const [c, x] = canvas(w, h);
    x.fillStyle = '#c9bfae'; x.fillRect(0, 0, w, h);
    const img = x.getImageData(0, 0, w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4;
      const n = N.fbm(i / 4, j / 4, 2) * 18 + (Math.random() - 0.5) * 14;
      img.data[k] += n; img.data[k + 1] += n; img.data[k + 2] += n;
    }
    x.putImageData(img, 0, 0);
    x.strokeStyle = 'rgba(60,52,44,0.85)'; x.lineWidth = 10;
    x.strokeRect(40, 40, w - 80, h - 80);
    x.lineWidth = 3; x.strokeRect(62, 62, w - 124, h - 124);
    x.fillStyle = 'rgba(60,52,44,0.8)';
    for (let i = 90; i < w - 90; i += 34) {
      x.beginPath(); x.moveTo(i, 52); x.lineTo(i + 10, 44); x.lineTo(i + 20, 52); x.lineTo(i + 10, 60); x.fill();
      x.beginPath(); x.moveTo(i, h - 52); x.lineTo(i + 10, h - 44); x.lineTo(i + 20, h - 52); x.lineTo(i + 10, h - 60); x.fill();
    }
    return canvasTexture(c);
  });
}

export function rugNormal() {
  return memo('rugN', () => canvasTexture(normalFromHeight((x, y) => Math.random() * 0.6 + N.n2(x / 3, y / 3) * 0.4, 256, 256, 2.5), { srgb: false, repeat: [4, 3] }));
}

// Football shirt: sky blue, darker tonal hoops, navy trim, name and number on the back.
export function jersey(name = 'OBAI', number = '10') {
  return memo('jersey' + name + number, () => {
    const w = 512, h = 640;
    const [c, x] = canvas(w, h);
    const draw = () => {
    x.fillStyle = '#7fb6e3'; x.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 46) {
      x.fillStyle = 'rgba(70,130,190,0.16)';
      x.fillRect(0, y, w, 20);
    }
    // fabric mesh dots
    x.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 9000; i++) x.fillRect(Math.random() * w, Math.random() * h, 1.2, 1.2);
    // collar and cuffs
    x.fillStyle = '#1c2c4c';
    x.beginPath(); x.ellipse(w / 2, 4, 80, 34, 0, 0, Math.PI); x.fill();
    x.fillStyle = '#ffffff'; x.fillRect(w / 2 - 76, 30, 152, 4);
    x.fillStyle = '#1c2c4c';
    x.font = '700 58px Archivo, "Arial Narrow", sans-serif';
    x.textAlign = 'center';
    x.fillText(name, w / 2, 170);
    x.font = '900 230px Archivo, "Arial Black", sans-serif';
    x.fillStyle = '#ffffff';
    x.fillText(number, w / 2, 430);
    x.lineWidth = 6; x.strokeStyle = '#1c2c4c'; x.strokeText(number, w / 2, 430);
    };
    draw();
    const tex = canvasTexture(c);
    document.fonts?.load('900 100px Archivo').then(() => { draw(); tex.needsUpdate = true; }).catch(() => {});
    return tex;
  });
}

// Book spines atlas
export function spines() {
  return memo('spines', () => {
    const w = 512, h = 256;
    const [c, x] = canvas(w, h);
    const cols = ['#2f3d4f', '#7a2f2a', '#c9b48a', '#3e5a45', '#1f1f22', '#d9d2c3', '#6d5a8c', '#a1662f', '#244a6b', '#8a8f94'];
    for (let i = 0; i < 16; i++) {
      x.fillStyle = cols[i % cols.length];
      x.fillRect(i * 32, 0, 32, h);
      x.fillStyle = 'rgba(255,255,255,0.22)';
      x.fillRect(i * 32 + 4, 30 + (i % 3) * 8, 24, 3);
      x.fillRect(i * 32 + 4, h - 40, 24, 2);
      x.fillStyle = 'rgba(0,0,0,0.18)';
      x.fillRect(i * 32, 0, 2, h);
    }
    return canvasTexture(c);
  });
}

export function brushedMetalRough() {
  return memo('brushed', () => {
    const w = 256, h = 256;
    const [c, x] = canvas(w, h);
    for (let j = 0; j < h; j++) {
      const v = 120 + N.n2(0.1, j / 1.5) * 40 + (Math.random() - 0.5) * 30;
      x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(0, j, w, 1);
    }
    return canvasTexture(c, { srgb: false });
  });
}

// Wood fallback (desk) when the photographed diffuse map is missing
export function woodDiffuse() {
  return memo('woodD', () => {
    const w = 512, h = 512;
    const [c, x] = canvas(w, h);
    const img = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const g = Math.sin((i / w) * 40 + N.fbm(i / 80, j / 300, 4) * 6) * 0.5 + 0.5;
      const k = (j * w + i) * 4;
      img.data[k] = 120 + g * 40; img.data[k + 1] = 82 + g * 28; img.data[k + 2] = 52 + g * 16; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return canvasTexture(c, { repeat: [1, 1] });
  });
}

// Spruce guitar top with fine grain
export function spruce() {
  return memo('spruce', () => {
    const w = 256, h = 512;
    const [c, x] = canvas(w, h);
    const img = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const g = Math.pow(Math.abs(Math.sin(i * 0.9 + N.n2(i / 30, j / 200) * 2)), 6);
      const k = (j * w + i) * 4;
      img.data[k] = 222 - g * 40; img.data[k + 1] = 186 - g * 40; img.data[k + 2] = 130 - g * 34; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return canvasTexture(c);
  });
}

export function rosewood() {
  return memo('rosewood', () => {
    const w = 256, h = 512;
    const [c, x] = canvas(w, h);
    const img = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const g = Math.sin(i * 0.25 + N.fbm(i / 40, j / 160, 3) * 5) * 0.5 + 0.5;
      const k = (j * w + i) * 4;
      img.data[k] = 70 + g * 30; img.data[k + 1] = 36 + g * 16; img.data[k + 2] = 24 + g * 10; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return canvasTexture(c);
  });
}

// Plant leaf (snake plant) with variegated bands
export function snakeLeaf() {
  return memo('leaf', () => {
    const w = 128, h = 512;
    const [c, x] = canvas(w, h);
    x.fillStyle = '#2f5b33'; x.fillRect(0, 0, w, h);
    for (let j = 0; j < h; j += 3) {
      const a = 0.25 + 0.25 * Math.sin(j * 0.12 + N.n2(0, j / 40) * 3);
      x.fillStyle = `rgba(150,180,120,${a * 0.5})`;
      x.fillRect(0, j, w, 2);
    }
    x.fillStyle = '#c7b85a'; x.fillRect(0, 0, 6, h); x.fillRect(w - 6, 0, 6, h);
    return canvasTexture(c);
  });
}

// Generic text/label sprite canvas helper
export function label(text, { w = 512, h = 128, font = '600 64px "IBM Plex Mono", monospace', color = '#fff', bg = null } = {}) {
  const [c, x] = canvas(w, h);
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  x.fillStyle = color; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w / 2, h / 2);
  return canvasTexture(c);
}

// Poster fallback (local test mode only)
export function posterFallback() {
  const [c, x] = canvas(512, 768);
  const g = x.createLinearGradient(0, 0, 0, 768);
  g.addColorStop(0, '#f2a65a'); g.addColorStop(0.55, '#d4507a'); g.addColorStop(1, '#2a1f4a');
  x.fillStyle = g; x.fillRect(0, 0, 512, 768);
  x.fillStyle = 'rgba(0,0,0,0.85)';
  for (let i = 0; i < 9; i++) x.fillRect(30 + i * 52, 520 - rand(40, 260), 40, 400);
  return canvasTexture(c);
}

export function noiseRoughness(base = 0.6, amp = 0.2, scale = 30) {
  return memo('nr' + base + amp + scale, () => {
    const s = 256;
    const [c, x] = canvas(s, s);
    const img = x.createImageData(s, s);
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const v = (base + N.fbm(i / scale, j / scale, 4) * amp) * 255;
      const k = (j * s + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return canvasTexture(c, { srgb: false, repeat: [2, 2] });
  });
}

export { THREE };
