import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { ASSETS } from './config.js';
import { buildRoom, ROOM, WINDOW } from './room.js';
import { buildSky } from './sky.js';
import { loadCharacter } from './character.js';
import { buildNav } from './nav.js';
import { Brain } from './brain.js';
import { createBall, solveShot } from './physics.js';
import { createTV, createDeckScreen, createStockScreen, createOled, createWhiteboard, sokoPlaceholder } from './screens.js';
import { createAudio } from './audio.js';
import { createUI } from './ui.js';
import { clamp, lerp, damp, nairobiTime } from './util.js';
import { buildProxies, mergeStatic, simplifyMaterials } from './optimize.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer: coarse)').matches;
const lowEnd = params.has('lq') || isTouch || (navigator.hardwareConcurrency || 8) <= 4;
const forcedHour = params.has('hour') ? parseFloat(params.get('hour')) : null;
const SIM_STEPS = Math.max(1, Math.min(40, parseInt(params.get('speed') || '1', 10)));
const NO_RENDER = params.has('norender');

// ------------------------------------------------------------------ renderer
// Two render paths. Phones draw straight to the canvas with hardware MSAA (crisp
// and cheap); computers go through a composer with MSAA, AO and bloom.
const DIRECT = lowEnd;
const renderer = new THREE.WebGLRenderer({ antialias: DIRECT, alpha: true, stencil: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
let dpr = Math.min(window.devicePixelRatio, lowEnd ? 1.75 : 2);
renderer.setPixelRatio(dpr);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // refreshed at a lower rate in the loop
renderer.setClearColor(0x000000, 0);
renderer.domElement.id = 'gl';
document.body.appendChild(renderer.domElement);
{ const v = document.createElement('div'); v.id = 'vignette'; document.body.appendChild(v); }
RectAreaLightUniformsLib.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color('#121212');
const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.05, 80);

// ------------------------------------------------------------------ loading
const manager = new THREE.LoadingManager();
const bar = $('#load-bar'), pct = $('#load-pct');
let shownPct = 0, realPct = 0;
manager.onProgress = (_, loaded, total) => { realPct = Math.max(realPct, loaded / total); };

const room = buildRoom(manager);
scene.add(room.group);
const proxies = buildProxies(room.hotspots, scene);
const mergeStats = mergeStatic(room.group);
if (lowEnd) simplifyMaterials(room.group);
// things that can sit between the camera and a live screen (monitor, TV)
{
  const zones = [
    new THREE.Box3(new THREE.Vector3(-2.95, 0, -2.95), new THREE.Vector3(-0.25, 2.4, -0.9)),
    new THREE.Box3(new THREE.Vector3(-3.42, 0.3, 0.1), new THREE.Vector3(-1.4, 2.2, 2.0)),
  ];
  room.group.traverse((o) => { if (o.isMesh) { const b = new THREE.Box3().setFromObject(o); if (zones.some((z) => b.intersectsBox(z))) o.layers.enable(2); } });
}
const sky = buildSky(WINDOW);
scene.add(sky.group);

// ------------------------------------------------------------------ lights
const sun = new THREE.DirectionalLight('#ffffff', 3);
sun.castShadow = true;
sun.shadow.mapSize.set(lowEnd ? 1024 : 2048, lowEnd ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 30 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025; sun.shadow.radius = 4;
sun.target.position.set(-1.2, 0, -1.2);
scene.add(sun, sun.target);

const hemi = new THREE.HemisphereLight('#bcd2ea', '#5a4636', 0.2);
scene.add(hemi);

// soft daylight from the window: an area light on computers, a cheap point light on phones
const windowFill = lowEnd ? new THREE.PointLight('#cfe0f0', 4, 7, 1.6) : new THREE.RectAreaLight('#cfe0f0', 4, WINDOW.x1 - WINDOW.x0, WINDOW.y1 - WINDOW.y0);
windowFill.position.set((WINDOW.x0 + WINDOW.x1) / 2, (WINDOW.y0 + WINDOW.y1) / 2, ROOM.minZ + (lowEnd ? 0.5 : 0.02));
if (!lowEnd) windowFill.lookAt(windowFill.position.x, windowFill.position.y - 0.3, 0);
scene.add(windowFill);

const bedLamp = new THREE.PointLight('#ffb46e', 0, 5.5, 2);
bedLamp.position.copy(room.props.bedLamp.pos).add(new THREE.Vector3(0, 0.02, 0.05));
scene.add(bedLamp);

const deskSpot = new THREE.SpotLight('#ffd6a8', 0, 4, 0.75, 0.7, 2);
deskSpot.position.set(-1.22, 1.13, -2.6);
deskSpot.target.position.set(-1.55, 0.75, -2.35);
deskSpot.castShadow = !lowEnd;
deskSpot.shadow.mapSize.set(1024, 1024); deskSpot.shadow.bias = -0.0005; deskSpot.shadow.radius = 3;
scene.add(deskSpot, deskSpot.target);

const tvLight = lowEnd ? new THREE.PointLight('#88aaff', 0, 4, 2) : new THREE.RectAreaLight('#88aaff', 0, room.props.tvSize[0], room.props.tvSize[1]);
tvLight.position.copy(room.props.tvCenter).add(new THREE.Vector3(lowEnd ? 0.4 : 0.03, 0, 0));
if (!lowEnd) tvLight.lookAt(tvLight.position.clone().add(new THREE.Vector3(1, 0, 0)));
scene.add(tvLight);

// environment
new HDRLoader(manager).load(ASSETS.hdr, (hdr) => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose(); pmrem.dispose();
}, undefined, () => console.warn('[env] HDR failed; continuing without IBL'));
scene.environmentIntensity = 0.4;

// ------------------------------------------------------------------ post
const composer = DIRECT ? null : new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true, depthBuffer: true }));
let gtao = null, bloom = null;
if (composer) {
composer.addPass(new RenderPass(scene, camera));
// guard: clamp runaway highlights and scrub NaNs before AO/bloom can smear them
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = vec4(min(c.rgb, vec3(14.0)), c.a); }',
}));
if ((navigator.hardwareConcurrency || 8) >= 8 && !params.has('noao')) {
  gtao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.85;
  gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.3, thickness: 1.2, scale: 1, samples: 16, distanceFallOff: 1 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  composer.addPass(gtao);
}
bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.22, 0.5, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());
}

// ------------------------------------------------------------------ screens + ball + audio
const screens = {
  tv: createTV(room.props.tvScreen),
  deck: createDeckScreen(room.props.deck.screen),
  stock: createStockScreen(room.props.stockScreen),
  oled: createOled(room.props.rack.oled),
  board: createWhiteboard(room.props.whiteboard),
};
sokoPlaceholder(room.props.sokoScreen);
const audio = createAudio();

let brain = null, kerry = null, ui = null;
const ball = createBall(scene, room.colliders, room.props.bounds, {
  onImpact(kind, speed, pos) {
    if (kind === 'rim') audio.sfx.rim(speed, pos.clone());
    else if (kind === 'board') audio.sfx.board(speed, pos.clone());
    else if (kind === 'kerry') { audio.sfx.bounce(speed, pos.clone()); brain?.hitByBall(); }
    else audio.sfx.bounce(speed, pos.clone(), kind === 'soft' ? 'soft' : 'floor');
  },
  onScore({ swish }) { audio.sfx.swish(new THREE.Vector3(0.75, 2.2, -2.5)); if (swish) audio.sfx.swish(new THREE.Vector3(0.75, 2.1, -2.5)); },
});
const nav = buildNav(room.colliders, room.props.bounds);

// ------------------------------------------------------------------ resize
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.fov = w / h < 0.8 ? 52 : w / h < 1.2 ? 44 : 36;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h);
  composer?.setSize(w, h);
  gtao?.setSize(w, h);
  ui?.setSize(w, h);
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    kerry = await loadCharacter(manager);
    scene.add(kerry.root);
  } catch (e) {
    console.error('[character] failed to load', e);
  }
  if (kerry) kerry.model.traverse((o) => { if (o.isMesh) o.layers.enable(2); });
  ball.mesh.layers.enable(2);
  ui = createUI({ renderer, camera, scene, room, kerry, ball, audio, screens, proxies });
  if (kerry) {
    brain = new Brain({ kerry, nav, room, ball, audio, screens, camera, ui });
    ui.brain = brain;
  }
  resize();
  if (brain) brain.begin();
  window.__room = { scene, camera, renderer, brain, kerry, ball, room, ui, audio, screens, sky, solveShot, THREE, mergeStats };
  ready = true;
}
let ready = false;
boot();

// enter overlay
$('#enter').onclick = () => {
  audio.init(); audio.ctx?.resume(); audio.setMuted(false);
  const sb = $('#sound-btn'); sb.textContent = 'Sound on'; sb.setAttribute('aria-pressed', 'true');
  document.body.classList.add('entered');
  if (!lowEnd) setTimeout(() => ui?.enableLive(), 2500);
};
$('#enter-quiet').onclick = () => {
  document.body.classList.add('entered');
  if (!lowEnd) setTimeout(() => ui?.enableLive(), 2500);
};

// ------------------------------------------------------------------ frame loop
const timer = new THREE.Timer();
timer.connect?.(document);
let frameTimes = [], qualityStep = 0, elapsed = 0, frameNo = 0;
const lampState = { bed: 0, desk: 0, led: 1 };

function frame(ts) {
  requestAnimationFrame(frame);
  timer.update(ts);
  // clamp: the first frames can report a negative delta, which would push lamps below zero
  const dt = NO_RENDER ? 1 / 30 : clamp(timer.getDelta(), 0, 1 / 20);
  elapsed += dt;

  // loading bar
  shownPct = damp(shownPct, realPct, 6, dt);
  bar.style.transform = `scaleX(${shownPct})`;
  pct.textContent = `${Math.round(shownPct * 100)}%`;
  if (ready && realPct >= 0.999 && !document.body.classList.contains('loaded')) document.body.classList.add('loaded');

  // time of day (Nairobi), optionally overridden with ?hour=
  const hours = forcedHour ?? nairobiTime().hours;
  const S = sky.setTime(hours, elapsed);
  const day = S.dayFactor;
  const elev = clamp(S.sunElev, 0.22, 0.9);
  const dir = new THREE.Vector3(S.sunAzi * 0.55, -Math.tan(elev * 0.9), 1).normalize();
  sun.position.copy(sun.target.position).addScaledVector(dir, -12);
  if (day > 0.05) {
    sun.color.copy(S.sunColor).lerp(new THREE.Color('#fff4e2'), 0.4);
    sun.intensity = 3.6 * day;
  } else {
    sun.color.set('#9fb6e6');
    sun.intensity = 0.35;
  }
  windowFill.color.copy(S.skyColor).lerp(new THREE.Color('#ffffff'), 0.3);
  windowFill.intensity = lowEnd ? lerp(0.3, 7, day) : lerp(0.25, 5, day);
  hemi.intensity = lerp(0.05, 0.22, day);
  scene.environmentIntensity = lerp(0.1, 0.45, day);
  renderer.toneMappingExposure = lerp(1.25, 1.02, day);

  // lamps: on in the evening and at night, off when Kerry sleeps
  const dark = 1 - day;
  const bedWant = ui?.lamps.bed ?? (dark > 0.25 ? 1 : 0);
  const deskWant = (brain?.activity === 'coding' && dark > 0.2) ? 1 : 0;
  lampState.bed = damp(lampState.bed, bedWant, 3, dt);
  lampState.desk = damp(lampState.desk, deskWant, 3, dt);
  bedLamp.intensity = lampState.bed * 2.0;
  room.props.bedLamp.shade.material.emissiveIntensity = lampState.bed * 1.4;
  deskSpot.intensity = lampState.desk * 4;
  room.props.deskLamp.bulb.visible = lampState.desk > 0.05;
  const sleeping = brain?.activity === 'sleep' && brain.lying;
  const beat = brain?.beat || 0;
  lampState.led = damp(lampState.led, sleeping ? 0.12 : 0.55 + dark * 0.45 + beat * 0.4, 4, dt);
  room.props.materials.ledWarm.color.setRGB(1.0, 0.82, 0.62).multiplyScalar(0.4 + lampState.led * 1.9);

  // Kerry (test mode can run several simulation steps per frame)
  for (let k = 0; k < SIM_STEPS; k++) {
    if (brain) {
      brain.update(dt);
      kerry.update(dt);
      brain.attachProps();
      ball.body.active = true;
      ball.body.a.copy(kerry.capsule.a); ball.body.b.copy(kerry.capsule.b);
    }
    ball.step(dt);
  }

  // screens
  screens.tv.update(dt);
  tvLight.color.copy(screens.tv.avg).multiplyScalar(1.8);
  tvLight.intensity = screens.tv.mode === 'off' ? 0 : (lowEnd ? 1.2 : 3.5);
  if (brain?.activity !== 'coding') screens.deck.update(dt, false);
  room.props.deck.update(dt);
  if (!lowEnd || frameNo % 2 === 0) screens.stock.update(lowEnd ? dt * 2 : dt);
  screens.oled.update(dt, brain?.rackBusy || 0);
  room.props.rack.update(dt, brain?.rackBusy ? 0.8 : 0.25);
  if (brain?.activity !== 'guitar') room.props.guitar.update(dt);
  const sub = room.props.subwoofer;
  const pump = (brain?.beat || 0);
  sub.cone.position.x = sub.coneX + pump * 0.012; sub.cap.position.x = sub.capX + pump * 0.014;
  room.props.consoleLed.visible = screens.tv.mode === 'game' || Math.sin(elapsed * 1.2) > -0.2;

  // UI + audio
  ui?.update(dt);
  audio.setListener(camera);
  audio.update();
  audio.tickCrickets(1 - day, new THREE.Vector3(-1.5, 1.6, -3));

  frameNo++;
  if (!NO_RENDER) {
    // shadows: the room is static, so refresh the maps at 20-30 Hz instead of every frame
    if (frameNo < 4 || frameNo % (lowEnd ? 3 : 2) === 0) renderer.shadowMap.needsUpdate = true;
    if (composer) composer.render(dt); else renderer.render(scene, camera);
    ui?.renderLive();
  }

  // adaptive quality: watch the frame time and shed the expensive passes
  frameTimes.push(dt);
  // never below 1.3x pixel density, so it stays sharp even when it backs off
  if (frameTimes.length > 120 && !params.has('shot') && document.visibilityState === 'visible') {
    const sorted = frameTimes.slice().sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)];
    frameTimes = [];
    if (p50 > 1 / 42 && qualityStep < 4) {
      qualityStep++;
      if (gtao && gtao.enabled) gtao.enabled = false;
      else if (dpr > 1.3) dpr = Math.max(1.3, dpr - 0.25);
      else if (bloom && bloom.enabled) bloom.enabled = false;
      else if (deskSpot.castShadow) { deskSpot.castShadow = false; }
      resize();
    }
  }
}
requestAnimationFrame(frame);
