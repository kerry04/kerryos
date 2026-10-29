import * as THREE from 'three';
import { canvas, canvasTexture, makeNoise, clamp, lerp, smooth } from './util.js';

// Window view: sky dome slice + Ngong hills + Nairobi skyline (with a KICC-like
// cylindrical tower) on separate depth layers for parallax. Lit windows fade
// in at dusk. Everything is driven by `setTime(hours)` (Nairobi local time).

const N = makeNoise(11);

function skylineCanvas(seed, w, h, { lit = false, near = false }) {
  const [c, x] = canvas(w, h);
  x.clearRect(0, 0, w, h);
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const base = h;
  const buildings = [];
  let px = 0;
  while (px < w) {
    const bw = near ? 40 + r() * 90 : 18 + r() * 46;
    let bh = near ? 60 + r() * 140 : 30 + r() * 120;
    if (!near && r() > 0.86) bh += 80 + r() * 90; // occasional towers
    buildings.push({ x: px, w: bw, h: bh });
    px += bw + (near ? 4 : 1);
  }
  // landmark: cylindrical tower with a saucer cap (centre-left)
  const lm = { x: w * 0.36, w: 34, h: near ? 0 : 230 };
  for (const b of buildings) {
    const shade = near ? 30 + r() * 18 : 52 + r() * 26;
    x.fillStyle = lit ? 'rgba(0,0,0,0)' : `rgb(${shade * 0.9},${shade * 0.92},${shade})`;
    if (!lit) x.fillRect(b.x, base - b.h, b.w, b.h);
    // windows
    const cols = Math.floor(b.w / 7), rows = Math.floor(b.h / 9);
    for (let i = 0; i < cols; i++) for (let j = 1; j < rows; j++) {
      const wx = b.x + 3 + i * 7, wy = base - b.h + j * 9;
      if (lit) {
        if (r() > 0.55) {
          const warm = r() > 0.3;
          x.fillStyle = warm ? `rgba(255,${190 + r() * 40},${120 + r() * 40},${0.55 + r() * 0.45})` : `rgba(180,210,255,${0.4 + r() * 0.4})`;
          x.fillRect(wx, wy, 3, 4);
        }
      } else {
        x.fillStyle = `rgba(160,180,200,${0.06 + r() * 0.08})`;
        x.fillRect(wx, wy, 3, 4);
      }
    }
    if (lit && b.h > 150 && r() > 0.4) { x.fillStyle = 'rgba(255,60,50,0.95)'; x.fillRect(b.x + b.w / 2 - 1.5, base - b.h - 4, 3, 3); }
  }
  if (lm.h) {
    const top = base - lm.h;
    if (!lit) {
      x.fillStyle = 'rgb(74,70,66)';
      x.fillRect(lm.x, top + 18, lm.w, lm.h - 18);
      for (let k = 0; k < 18; k++) { x.fillStyle = `rgba(30,30,32,0.6)`; x.fillRect(lm.x, top + 24 + k * 11, lm.w, 4); }
      x.fillStyle = 'rgb(84,78,72)';
      x.beginPath(); x.ellipse(lm.x + lm.w / 2, top + 16, 30, 8, 0, 0, Math.PI * 2); x.fill();
      x.fillRect(lm.x + lm.w / 2 - 2, top - 6, 4, 16);
    } else {
      for (let k = 0; k < 18; k++) { x.fillStyle = `rgba(255,214,150,${0.5 + r() * 0.4})`; x.fillRect(lm.x + 2, top + 24 + k * 11, lm.w - 4, 2); }
      x.fillStyle = 'rgba(255,70,60,1)'; x.fillRect(lm.x + lm.w / 2 - 2, top - 8, 4, 4);
    }
  }
  return c;
}

function hillsCanvas(w, h) {
  const [c, x] = canvas(w, h);
  x.beginPath(); x.moveTo(0, h);
  for (let i = 0; i <= w; i += 4) {
    const t = i / w;
    // the Ngong hills: a run of soft knuckles on the right half
    const knuckles = t > 0.45 ? Math.max(0, Math.sin((t - 0.45) * Math.PI * 7)) * 22 * Math.sin(((t - 0.45) / 0.55) * Math.PI) : 0;
    const y = h - 40 - N.fbm(t * 6, 0.3, 4) * 30 - knuckles - (t > 0.45 ? 24 * Math.sin(((t - 0.45) / 0.55) * Math.PI) : 0);
    x.lineTo(i, y);
  }
  x.lineTo(w, h); x.closePath();
  x.fillStyle = '#ffffff'; x.fill();
  return c;
}

export function buildSky(win, wallZ = -3.075) {
  const group = new THREE.Group();
  // stencil portal: the outdoor layers only draw where the window opening is
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(win.x1 - win.x0, win.y1 - win.y0), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp }));
  portal.position.set((win.x0 + win.x1) / 2, (win.y0 + win.y1) / 2, wallZ);
  portal.renderOrder = -10;
  group.add(portal);
  const outside = (m) => { m.stencilWrite = true; m.stencilRef = 1; m.stencilFunc = THREE.EqualStencilFunc; m.stencilZPass = THREE.KeepStencilOp; return m; };
  const cx = (win.x0 + win.x1) / 2, cy = (win.y0 + win.y1) / 2;
  const uniforms = {
    uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
    uSun: { value: new THREE.Vector2(0.3, 0.5) }, uSunCol: { value: new THREE.Color() }, uSunSize: { value: 0.03 },
    uStars: { value: 0 }, uTime: { value: 0 }, uMoon: { value: 0 },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uTop, uMid, uHorizon, uSunCol; uniform vec2 uSun; uniform float uSunSize, uStars, uTime, uMoon;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      void main(){
        float y = vUv.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.45, y));
        col = mix(col, uTop, smoothstep(0.45, 1.0, y));
        float d = distance(vUv * vec2(2.0,1.0), uSun * vec2(2.0,1.0));
        col += uSunCol * (smoothstep(uSunSize, uSunSize*0.6, d) * 3.0 + exp(-d * 9.0) * 0.6);
        // moon crescent at night
        if (uMoon > 0.0) {
          float m = smoothstep(0.03, 0.026, d) - smoothstep(0.03, 0.026, distance(vUv*vec2(2.0,1.0), (uSun+vec2(0.012,0.01))*vec2(2.0,1.0)));
          col += vec3(0.85,0.88,0.95) * m * uMoon * 1.4;
        }
        vec2 g = floor(vUv * vec2(300.0, 160.0));
        float s = step(0.996, hash(g)) * smoothstep(0.25, 0.8, y);
        float tw = 0.6 + 0.4 * sin(uTime * 2.0 + hash(g) * 30.0);
        col += vec3(s * tw * uStars);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    depthWrite: false,
  });
  outside(skyMat);
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(26, 12), skyMat);
  sky.renderOrder = 5;
  sky.position.set(cx, cy + 2.5, -16);
  group.add(sky);

  // hills (tinted by atmosphere colour)
  const hillsTex = canvasTexture(hillsCanvas(1024, 160));
  const hillsMat = new THREE.MeshBasicMaterial({ map: hillsTex, transparent: true, color: new THREE.Color(), depthWrite: false });
  outside(hillsMat);
  const hills = new THREE.Mesh(new THREE.PlaneGeometry(22, 3.4), hillsMat);
  hills.renderOrder = 6;
  hills.position.set(cx, cy - 0.6, -14);
  group.add(hills);

  // far city + near city, each with a day silhouette and a night-lights layer
  const layers = [];
  const mk = (seed, near, w, h, z, y, width, height) => {
    const day = canvasTexture(skylineCanvas(seed, w, h, { lit: false, near }));
    const lit = canvasTexture(skylineCanvas(seed, w, h, { lit: true, near }));
    const dayMat = new THREE.MeshBasicMaterial({ map: day, transparent: true, color: new THREE.Color(), depthWrite: false });
    const litMat = new THREE.MeshBasicMaterial({ map: lit, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const geo = new THREE.PlaneGeometry(width, height);
    outside(dayMat); outside(litMat);
    const a = new THREE.Mesh(geo, dayMat), b = new THREE.Mesh(geo, litMat);
    a.renderOrder = near ? 8 : 7; b.renderOrder = near ? 8.5 : 7.5;
    a.position.set(cx, y, z); b.position.set(cx, y, z + 0.01);
    group.add(a, b);
    layers.push({ dayMat, litMat, near });
  };
  mk(1234567, false, 2048, 300, -10, cy - 0.15, 16, 2.35);
  mk(7654321, true, 1024, 260, -6.5, cy - 0.9, 9, 2.3);

  // a couple of slow planes / birds would be cute; one blinking aircraft at night
  const plane = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), outside(new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.4, 0.3), toneMapped: false })));
  plane.renderOrder = 6.5;
  plane.position.set(cx - 6, cy + 2, -12);
  group.add(plane);

  const state = { night: 0, sunElev: 0, sunAzi: 0, sunColor: new THREE.Color(), skyColor: new THREE.Color(), dayFactor: 1 };

  function setTime(hours, t) {
    uniforms.uTime.value = t;
    // Near the equator: sunrise ~06:30, sunset ~18:40, high noon
    const rise = 6.5, set = 18.65;
    const dayT = (hours - rise) / (set - rise); // 0..1 across the day
    const elev = Math.sin(clamp(dayT, -0.2, 1.2) * Math.PI); // -..1
    state.sunElev = elev;
    state.sunAzi = lerp(-1, 1, clamp(dayT, 0, 1));
    const day = smooth(clamp((elev + 0.08) / 0.35, 0, 1));
    const golden = clamp(1 - Math.abs(elev - 0.08) / 0.22, 0, 1) * (elev > -0.1 ? 1 : 0);
    state.night = 1 - day;
    state.dayFactor = day;

    const nightTop = new THREE.Color('#03050b'), nightMid = new THREE.Color('#0a1222'), nightHz = new THREE.Color('#1a2133');
    const dayTop = new THREE.Color('#3f7fc0'), dayMid = new THREE.Color('#7fb1df'), dayHz = new THREE.Color('#d3e3ee');
    const goldHz = new THREE.Color('#f2a35e'), goldMid = new THREE.Color('#d97f6a');
    uniforms.uTop.value.copy(nightTop).lerp(dayTop, day);
    uniforms.uMid.value.copy(nightMid).lerp(dayMid, day).lerp(goldMid, golden * 0.6);
    uniforms.uHorizon.value.copy(nightHz).lerp(dayHz, day).lerp(goldHz, golden * 0.85);
    // sun / moon position in the window's UV
    const sx = 0.5 + state.sunAzi * 0.32;
    if (day > 0.02) {
      uniforms.uSun.value.set(sx, clamp(0.12 + elev * 0.75, 0.05, 0.92));
      uniforms.uSunCol.value.set('#fff1d8').lerp(new THREE.Color('#ff9a4a'), golden);
      uniforms.uSunCol.value.multiplyScalar(day);
      uniforms.uSunSize.value = 0.026;
      uniforms.uMoon.value = 0;
    } else {
      // moon drifts across through the night
      const nt = ((hours + 24 - 19) % 24) / 11;
      uniforms.uSun.value.set(0.2 + nt * 0.6, 0.55 + Math.sin(nt * Math.PI) * 0.25);
      uniforms.uSunCol.value.set(0, 0, 0);
      uniforms.uMoon.value = 1 - day;
    }
    uniforms.uStars.value = Math.pow(1 - day, 2) * 0.9;

    const haze = new THREE.Color().copy(uniforms.uHorizon.value).lerp(new THREE.Color('#5b6878'), 0.35 * day);
    hillsMat.color.copy(haze).multiplyScalar(day > 0.5 ? 0.82 : 0.55);
    for (const L of layers) {
      const tone = L.near ? 0.42 : 0.62;
      L.dayMat.color.setRGB(1, 1, 1).multiplyScalar(lerp(0.12, tone + 0.25, day)).lerp(haze, L.near ? 0.08 : 0.25);
      L.litMat.opacity = smooth(clamp((0.55 - day) / 0.5, 0, 1));
    }
    plane.visible = day < 0.4;
    plane.position.x = cx - 6 + ((t * 0.15) % 14);
    plane.material.color.setRGB(Math.sin(t * 6) > 0.6 ? 3 : 0.2, 0.3, 0.25);

    state.sunColor.copy(uniforms.uSunCol.value);
    state.skyColor.copy(uniforms.uMid.value);
    state.golden = golden;
    return state;
  }

  return { group, setTime, state };
}
