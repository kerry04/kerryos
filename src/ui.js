import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { SPOTS, TOUR, LINKS } from './config.js';
import { clamp, easeInOut, nairobiTime, canvas, canvasTexture } from './util.js';
import { ROOM } from './room.js';

export const HOME = { pos: new THREE.Vector3(5.4, 4.15, 6.1), target: new THREE.Vector3(-0.55, 0.95, -0.75) };

const VIEWS = {
  soko: [[-0.7, 1.42, -1.6], [-1.6, 1.24, -2.82]],
  stock: [[-1.55, 1.35, -1.7], [-2.38, 1.12, -2.68]],
  deck: [[-1.0, 1.32, -1.75], [-1.6, 0.86, -2.45]],
  rack: [[0.55, 1.25, -1.25], [-0.35, 0.7, -2.7]],
  board: [[-1.25, 1.62, -0.95], [-3.47, 1.48, -1.2]],
  window: [[-0.45, 1.55, -0.6], [-1.55, 1.62, -3.0]],
  poster: [[-1.95, 1.65, -1.5], [-3.48, 1.72, -2.42]],
  tv: [[0.35, 1.75, 1.75], [-3.1, 1.0, 1.05]],
  shelf: [[-1.55, 2.25, 1.55], [-3.39, 2.08, 1.05]],
  guitar: [[2.9, 1.45, 1.4], [1.9, 0.75, -0.6]],
  hoop: [[1.85, 1.75, 1.45], [0.75, 1.75, -2.4]],
  jersey: [[2.35, 1.75, -0.55], [2.62, 1.92, -2.95]],
  bed: [[1.2, 2.1, 1.0], [2.6, 0.6, -1.8]],
};

export function createUI({ renderer, camera, scene, room, kerry, ball, audio, screens }) {
  const $ = (s) => document.querySelector(s);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 1.2; controls.maxDistance = 11;
  controls.minPolarAngle = 0.32; controls.maxPolarAngle = 1.42;
  controls.minAzimuthAngle = -0.05; controls.maxAzimuthAngle = 1.55;
  controls.rotateSpeed = 0.55; controls.zoomSpeed = 0.8; controls.panSpeed = 0.6;
  controls.screenSpacePanning = true;
  camera.position.copy(HOME.pos); controls.target.copy(HOME.target);
  const camParam = new URLSearchParams(location.search).get('cam');
  if (camParam) { const v = camParam.split(',').map(Number); camera.position.set(v[0], v[1], v[2]); controls.target.set(v[3], v[4], v[5]); controls.minDistance = 0.3; }
  controls.update();

  const lamps = { bed: null, desk: null }; // null = automatic
  const ui = { controls, lamps, onThought: null, zzz: null, following: false, tour: null };

  // --------------------------------------------------------- camera flight
  let flight = null;
  function flyTo(pos, target, dur = 1.3) {
    flight = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), t: 0, dur };
  }
  function flyToSpot(id) {
    if (id === 'kerry') {
      const head = kerry ? kerry.wp('head') : new THREE.Vector3(0, 1.4, 0);
      const dir = camera.position.clone().sub(head).setY(0).normalize();
      const pos = head.clone().addScaledVector(dir, 2.3).add(new THREE.Vector3(0, 0.35, 0));
      flyTo(pos, head.clone().add(new THREE.Vector3(0, -0.25, 0)));
      return;
    }
    if (id === 'intro' || id === 'outro' || !VIEWS[id]) { flyTo(HOME.pos, HOME.target); return; }
    const [p, t] = VIEWS[id];
    let target = new THREE.Vector3(...t), pos = new THREE.Vector3(...p);
    if (id === 'guitar') { const g = room.props.guitar.group.getWorldPosition(new THREE.Vector3()); pos.add(g.clone().sub(target)); target = g; }
    flyTo(pos, target);
  }

  // --------------------------------------------------------- info panel
  const panel = $('#panel');
  function openPanel(id) {
    const s = SPOTS[id]; if (!s) return;
    panel.querySelector('.p-kind').textContent = s.kind;
    panel.querySelector('.p-title').textContent = s.title;
    const body = panel.querySelector('.p-body'); body.innerHTML = '';
    s.body.forEach((t) => { const p = document.createElement('p'); p.textContent = t; body.appendChild(p); });
    const links = panel.querySelector('.p-links'); links.innerHTML = '';
    (s.links || []).forEach(([label, key]) => {
      const a = document.createElement('a'); a.href = LINKS[key]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = label + ' ↗'; links.appendChild(a);
    });
    if (s.live) {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Use it here'; b.onclick = () => useSoko(true); links.prepend(b);
    }
    panel.dataset.id = id;
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('open'));
  }
  function closePanel() { panel.classList.remove('open'); setTimeout(() => { if (!panel.classList.contains('open')) panel.hidden = true; }, 250); }
  $('#panel .p-close').onclick = () => { closePanel(); if (!ui.tour) flyTo(HOME.pos, HOME.target); };

  // --------------------------------------------------------- SokoResult live screen (CSS3D behind a hole in the canvas)
  const cssRenderer = new CSS3DRenderer();
  cssRenderer.domElement.id = 'css3d';
  document.body.prepend(cssRenderer.domElement);
  const IFW = 1280, IFH = 720;
  const frameWrap = document.createElement('div');
  frameWrap.className = 'soko-frame';
  frameWrap.style.width = IFW + 'px'; frameWrap.style.height = IFH + 'px';
  const iframe = document.createElement('iframe');
  iframe.title = 'SokoResult (live)';
  iframe.setAttribute('allow', 'clipboard-write');
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  frameWrap.appendChild(iframe);
  const cssObj = new CSS3DObject(frameWrap);
  const cssScene = new THREE.Scene();
  cssScene.add(cssObj);
  const sokoMesh = room.props.sokoScreen;
  const [sw] = room.props.sokoSize;
  function syncCss() {
    sokoMesh.updateMatrixWorld(true);
    sokoMesh.matrixWorld.decompose(cssObj.position, cssObj.quaternion, cssObj.scale);
    cssObj.scale.setScalar(sw / IFW);
  }
  syncCss();
  // the hole: writes transparent pixels where the monitor is visible
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.ZeroFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.ZeroFactor, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const hole = new THREE.Mesh(sokoMesh.geometry, holeMat);
  const holeScene = new THREE.Scene(); holeScene.add(hole);
  hole.matrixAutoUpdate = false;
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  let liveEnabled = false;
  function enableLive() {
    if (liveEnabled) return;
    liveEnabled = true;
    iframe.src = LINKS.soko;
  }
  let using = false;
  function useSoko(on) {
    using = on;
    document.body.classList.toggle('using-soko', on);
    renderer.domElement.style.pointerEvents = on ? 'none' : '';
    if (on) { flyTo(new THREE.Vector3(-1.6, 1.24, -2.05), new THREE.Vector3(-1.6, 1.24, -2.82), 1.1); closePanel(); }
    else flyTo(new THREE.Vector3(...VIEWS.soko[0]), new THREE.Vector3(...VIEWS.soko[1]));
  }
  $('#exit-soko').onclick = () => useSoko(false);

  function renderLive() {
    if (!liveEnabled) return;
    syncCss();
    // only bother when the monitor is in view
    const p = sokoMesh.getWorldPosition(new THREE.Vector3()).project(camera);
    const inView = p.z < 1 && Math.abs(p.x) < 1.3 && Math.abs(p.y) < 1.3;
    cssRenderer.domElement.style.visibility = inView ? 'visible' : 'hidden';
    if (!inView) return;
    renderer.autoClear = false;
    renderer.clearDepth();
    scene.overrideMaterial = depthOnly;
    const bg = scene.background; scene.background = null;
    renderer.render(scene, camera);
    scene.background = bg;
    scene.overrideMaterial = null;
    hole.matrix.copy(sokoMesh.matrixWorld);
    hole.matrixWorld.copy(sokoMesh.matrixWorld);
    renderer.render(holeScene, camera);
    renderer.autoClear = true;
    cssRenderer.render(cssScene, camera);
  }

  // --------------------------------------------------------- picking
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pickables = [];
  for (const [id, objs] of Object.entries(room.hotspots)) objs.forEach((o) => { o.traverse((c) => { if (c.isMesh) { c.userData.hotspot = id; pickables.push(c); } }); });
  if (kerry) kerry.model.traverse((c) => { if (c.isMesh) { c.userData.hotspot = 'kerry'; pickables.push(c); } });
  pickables.push(ball.mesh);
  const tip = $('#tip');
  let hoverId = null, lastMove = 0;
  function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hits = ray.intersectObjects(pickables, false);
    return hits[0] || null;
  }
  renderer.domElement.addEventListener('pointermove', (ev) => {
    if (drag) { dragMove(ev); return; }
    const now = performance.now(); if (now - lastMove < 40) return; lastMove = now;
    const h = pick(ev);
    const id = h ? h.object.userData.hotspot : null;
    hoverId = id;
    renderer.domElement.style.cursor = id ? 'pointer' : '';
    if (id && SPOTS[id] && ev.pointerType === 'mouse') {
      tip.textContent = h.object.userData.isBall ? (ball.isFree() ? 'Drag to throw' : 'Kerry has the ball') : SPOTS[id].title;
      tip.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 14}px)`;
      tip.hidden = false;
    } else tip.hidden = true;
  });
  renderer.domElement.addEventListener('pointerleave', () => { tip.hidden = true; });
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    const h = pick(ev);
    if (h && h.object.userData.isBall && ball.isFree()) startDrag(ev, h.point);
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (drag) { endDrag(); return; }
    if (!downAt) return;
    const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
    downAt = null;
    if (moved > 6) return;
    const h = pick(ev);
    if (!h) return;
    const id = h.object.userData.hotspot;
    if (!id) return;
    stopTour();
    if (id === 'kerry') { ui.brain?.poke(); }
    flyToSpot(id);
    openPanel(id);
    if (id === 'soko') enableLive();
  });

  // --------------------------------------------------------- throwing the ball
  let drag = null;
  function startDrag(ev, point) {
    controls.enabled = false;
    const n = camera.getWorldDirection(new THREE.Vector3()).negate();
    drag = { plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, ball.state.pos), hist: [], pos: ball.state.pos.clone(), id: ev.pointerId };
    renderer.domElement.setPointerCapture?.(ev.pointerId);
    ball.hold(() => drag ? drag.pos : ball.state.pos);
    tip.hidden = true;
  }
  function dragMove(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const p = new THREE.Vector3();
    if (ray.ray.intersectPlane(drag.plane, p)) {
      p.x = clamp(p.x, ROOM.minX + 0.15, ROOM.maxX - 0.15); p.z = clamp(p.z, ROOM.minZ + 0.15, ROOM.maxZ - 0.15); p.y = clamp(p.y, 0.15, 2.6);
      drag.pos.copy(p);
      drag.hist.push([performance.now(), p.clone()]);
      while (drag.hist.length > 2 && performance.now() - drag.hist[0][0] > 90) drag.hist.shift();
    }
  }
  function endDrag() {
    const h = drag.hist;
    let v = new THREE.Vector3();
    if (h.length >= 2) {
      const [t0, p0] = h[0], [t1, p1] = h[h.length - 1];
      const dt = Math.max(0.016, (t1 - t0) / 1000);
      v.subVectors(p1, p0).multiplyScalar(1.15 / dt);
      // flicks feel better with some loft toward the hoop side
      v.y += Math.min(3, v.length() * 0.35);
      if (v.length() > 9.5) v.setLength(9.5);
    }
    drag = null;
    controls.enabled = !using;
    ball.release(v, new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(6));
  }

  // --------------------------------------------------------- HUD
  const statusEl = $('#status'), detailEl = $('#detail'), clockEl = $('#clock');
  const bubble = $('#bubble');
  const meters = { energy: $('#m-energy'), fun: $('#m-fun'), drive: $('#m-drive'), move: $('#m-move') };
  let bubbleUntil = 0;
  ui.onThought = (text) => { bubble.textContent = text; bubble.classList.add('show'); bubbleUntil = performance.now() + 4200; };
  // floating z's while asleep
  const zTex = (() => { const [c, x] = canvas(64, 64); x.font = '700 48px Archivo, sans-serif'; x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.fillText('z', 32, 48); return canvasTexture(c); })();
  const zs = [];
  ui.zzz = (pos) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTex, transparent: true, depthWrite: false, opacity: 0 }));
    s.position.copy(pos).add(new THREE.Vector3(0.05, 0.12, 0)); s.scale.setScalar(0.07);
    scene.add(s); zs.push({ s, t: 0 });
  };

  // --------------------------------------------------------- tour
  let tourIdx = -1, tourAudio = null, tourTimer = null;
  function stopTour() {
    if (!ui.tour) return;
    ui.tour = null; tourIdx = -1;
    tourAudio?.pause(); tourAudio = null; clearTimeout(tourTimer);
    $('#tour-btn').textContent = 'Tour';
    $('#tour-btn').setAttribute('aria-pressed', 'false');
  }
  function tourStep() {
    tourIdx++;
    if (tourIdx >= TOUR.length) { stopTour(); flyTo(HOME.pos, HOME.target); closePanel(); return; }
    const id = TOUR[tourIdx];
    flyToSpot(id);
    if (SPOTS[id]) openPanel(id); else closePanel();
    if (id === 'soko') enableLive();
    const name = id === 'intro' ? 'tour-intro' : id === 'outro' ? 'tour-outro' : SPOTS[id]?.audio;
    const advance = () => { tourTimer = setTimeout(() => ui.tour && tourStep(), 700); };
    if (name && audio.enabled) {
      tourAudio = audio.voiceClip(name);
      tourAudio.onended = advance;
      tourAudio.onerror = () => { tourTimer = setTimeout(() => ui.tour && tourStep(), 5000); };
      tourAudio.play().catch(() => { tourTimer = setTimeout(() => ui.tour && tourStep(), 5000); });
    } else tourTimer = setTimeout(() => ui.tour && tourStep(), 6000);
  }
  $('#tour-btn').onclick = () => {
    if (ui.tour) { stopTour(); flyTo(HOME.pos, HOME.target); closePanel(); return; }
    ui.tour = true; tourIdx = -1;
    $('#tour-btn').textContent = 'Stop tour';
    $('#tour-btn').setAttribute('aria-pressed', 'true');
    if (audio.enabled) { const a = audio.voiceClip('jarvis-tour'); a.onended = tourStep; a.play().catch(tourStep); } else tourStep();
  };
  $('#home-btn').onclick = () => { stopTour(); closePanel(); ui.following = false; $('#follow-btn').setAttribute('aria-pressed', 'false'); flyTo(HOME.pos, HOME.target); };
  $('#follow-btn').onclick = () => {
    ui.following = !ui.following;
    $('#follow-btn').setAttribute('aria-pressed', String(ui.following));
    if (ui.following) { stopTour(); flyToSpot('kerry'); }
  };
  const soundBtn = $('#sound-btn');
  soundBtn.onclick = () => {
    if (!audio.ctx) { audio.init(); audio.ctx?.resume(); audio.setMuted(false); }
    else { audio.ctx.resume(); audio.setMuted(!audio.muted); }
    soundBtn.setAttribute('aria-pressed', String(!audio.muted));
    soundBtn.textContent = audio.muted ? 'Sound off' : 'Sound on';
  };

  // --------------------------------------------------------- frame
  const fmtNeed = (v) => `${Math.round(v * 100)}%`;
  let hudT = 0;
  function update(dt) {
    if (flight) {
      flight.t = Math.min(flight.dur, flight.t + dt);
      const k = easeInOut(flight.t / flight.dur);
      camera.position.lerpVectors(flight.p0, flight.p1, k);
      controls.target.lerpVectors(flight.t0, flight.t1, k);
      // arc a little so long flights don't clip through furniture
      camera.position.y += Math.sin(k * Math.PI) * Math.min(0.8, flight.p0.distanceTo(flight.p1) * 0.12);
      if (flight.t >= flight.dur) flight = null;
    } else if (ui.following && kerry) {
      const head = kerry.wp('hips');
      controls.target.lerp(head.clone().add(new THREE.Vector3(0, 0.3, 0)), 1 - Math.exp(-dt * 2.5));
    }
    controls.enabled = !flight && !drag && !using;
    controls.update();
    // keep the target inside the room
    controls.target.x = clamp(controls.target.x, ROOM.minX + 0.2, ROOM.maxX - 0.2);
    controls.target.z = clamp(controls.target.z, ROOM.minZ + 0.2, ROOM.maxZ - 0.2);
    controls.target.y = clamp(controls.target.y, 0.2, 2.4);

    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i]; z.t += dt;
      z.s.position.y += dt * 0.12; z.s.position.x += Math.sin(z.t * 3) * dt * 0.03;
      z.s.material.opacity = Math.min(1, z.t * 2) * Math.max(0, 1 - z.t / 2.6) * 0.85;
      z.s.scale.setScalar(0.06 + z.t * 0.03);
      if (z.t > 2.6) { scene.remove(z.s); z.s.material.dispose(); zs.splice(i, 1); }
    }

    // thought bubble anchored over Kerry's head
    if (kerry && bubble.classList.contains('show')) {
      const head = kerry.wp('head').add(new THREE.Vector3(0, 0.32, 0)).project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      const x = (head.x * 0.5 + 0.5) * r.width, y = (-head.y * 0.5 + 0.5) * r.height;
      const vis = head.z < 1 && x > 0 && x < r.width && y > 0 && y < r.height;
      bubble.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
      bubble.style.visibility = vis ? 'visible' : 'hidden';
      if (performance.now() > bubbleUntil) bubble.classList.remove('show');
    }

    hudT += dt;
    const brain = ui.brain;
    if (hudT > 0.25 && brain) {
      hudT = 0;
      statusEl.textContent = brain.status || '';
      detailEl.textContent = brain.detail || '';
      for (const k of Object.keys(meters)) { meters[k].style.setProperty('--v', brain.needs[k]); meters[k].title = fmtNeed(brain.needs[k]); }
      const nt = nairobiTime();
      clockEl.textContent = nt.label;
    }
  }

  return Object.assign(ui, { update, renderLive, flyTo, flyToSpot, openPanel, enableLive, cssRenderer, setSize(w, h) { cssRenderer.setSize(w, h); } });
}
