import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { SPOTS, TOUR, TOUR_LINES, LINKS } from './config.js';
import { clamp, easeInOut, nairobiTime, canvas, canvasTexture } from './util.js';
import { ROOM } from './room.js';
import { createSpotify } from './spotify.js';

export const HOME = { pos: new THREE.Vector3(5.4, 4.15, 6.1), target: new THREE.Vector3(-0.55, 0.95, -0.75) };

const VIEWS = {
  soko: [[-0.7, 1.45, -1.6], [-1.6, 1.33, -2.82]],
  stock: [[-1.55, 1.35, -1.7], [-2.38, 1.12, -2.68]],
  deck: [[-1.25, 1.2, -1.85], [-1.6, 0.88, -2.5]],
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

export function createUI({ renderer, camera, scene, room, kerry, ball, audio, screens, proxies = [] }) {
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
    panel.querySelector('.music')?.remove();
    if (id === 'tv') renderMusic();
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('open'));
  }
  function closePanel() { panel.classList.remove('open'); setTimeout(() => { if (!panel.classList.contains('open')) panel.hidden = true; }, 250); }
  $('#panel .p-close').onclick = () => { closePanel(); if (!ui.tour) flyTo(HOME.pos, HOME.target); };

  // --------------------------------------------------------- live screens (CSS3D behind holes in the canvas)
  // SokoResult on the monitor, Spotify on the TV. Each is a real web page
  // positioned in 3D behind the WebGL canvas; a "hole" pass clears the canvas
  // where the screen is visible and nothing stands in front of it.
  const cssRenderer = new CSS3DRenderer();
  cssRenderer.domElement.id = 'css3d';
  document.body.prepend(cssRenderer.domElement);
  const cssScene = new THREE.Scene();
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.ZeroFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.ZeroFactor, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const holeScene = new THREE.Scene();
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  const surfaces = [];
  function surface(mesh, width, pxW, pxH, el) {
    el.style.width = pxW + 'px'; el.style.height = pxH + 'px';
    const obj = new CSS3DObject(el); obj.visible = false; cssScene.add(obj);
    const hole = new THREE.Mesh(mesh.geometry, holeMat); hole.matrixAutoUpdate = false; holeScene.add(hole);
    const sf = { mesh, obj, hole, on: false, sync() {
      mesh.updateMatrixWorld(true);
      mesh.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);
      obj.scale.setScalar(width / pxW);
      hole.matrix.copy(mesh.matrixWorld); hole.matrixWorld.copy(mesh.matrixWorld);
    } };
    sf.sync(); surfaces.push(sf);
    return sf;
  }
  // SokoResult
  const frameWrap = document.createElement('div');
  frameWrap.className = 'soko-frame';
  const iframe = document.createElement('iframe');
  iframe.title = 'SokoResult (live)';
  iframe.setAttribute('allow', 'clipboard-write');
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  frameWrap.appendChild(iframe);
  const sokoSurf = surface(room.props.sokoScreen, room.props.sokoSize[0], 1280, 720, frameWrap);
  function enableLive() {
    if (sokoSurf.on) return;
    sokoSurf.on = true; sokoSurf.obj.visible = true;
    iframe.src = LINKS.soko;
  }
  let using = false;
  function useSoko(on) {
    using = on;
    document.body.classList.toggle('using-soko', on);
    renderer.domElement.style.pointerEvents = on ? 'none' : '';
    if (on) { flyTo(new THREE.Vector3(-1.6, 1.33, -2.05), new THREE.Vector3(-1.6, 1.33, -2.82), 1.1); closePanel(); }
    else flyTo(new THREE.Vector3(...VIEWS.soko[0]), new THREE.Vector3(...VIEWS.soko[1]));
  }
  $('#exit-soko').onclick = () => useSoko(false);

  // Spotify on the TV
  const tvWrap = document.createElement('div');
  tvWrap.className = 'tv-frame';
  const tvSurf = surface(room.props.tvScreen, room.props.tvSize[0], 640, 360, tvWrap);
  const music = createSpotify(tvWrap);
  music.onChange((st) => {
    tvSurf.on = st.on; tvSurf.obj.visible = st.on;
    screens.tv.music = st.on ? music.tracks[st.index] : null;
    if (ui.brain) ui.brain.setMusic(st.on && (st.playing || st.buffering));
    if (panel.dataset.id === 'tv' && !panel.hidden) renderMusic();
  });

  function renderLive() {
    const live = surfaces.filter((sf) => sf.on);
    if (!live.length) return;
    const tmp = new THREE.Vector3();
    let any = false;
    for (const sf of live) {
      sf.sync();
      const p = sf.mesh.getWorldPosition(tmp).project(camera);
      sf.hole.visible = p.z < 1 && Math.abs(p.x) < 1.4 && Math.abs(p.y) < 1.4;
      any ||= sf.hole.visible;
    }
    for (const sf of surfaces) if (!sf.on) sf.hole.visible = false;
    cssRenderer.domElement.style.visibility = any ? 'visible' : 'hidden';
    if (!any) return;
    renderer.autoClear = false;
    renderer.clearDepth();
    // depth of whatever could stand in front of a screen (layer 2 only)
    scene.overrideMaterial = depthOnly;
    const bg = scene.background; scene.background = null;
    camera.layers.set(2);
    renderer.render(scene, camera);
    camera.layers.set(0);
    scene.background = bg;
    scene.overrideMaterial = null;
    renderer.render(holeScene, camera);
    renderer.autoClear = true;
    cssRenderer.render(cssScene, camera);
  }

  // the TV panel doubles as the music player
  function renderMusic() {
    let box = panel.querySelector('.music');
    const st = music.state, cur = music.tracks[st.index];
    const sig = [st.on, st.index, st.playing, st.buffering, st.error].join('|');
    if (box && box.dataset.sig === sig) return;
    if (!box) { box = document.createElement('div'); box.className = 'music'; panel.querySelector('.p-links').after(box); }
    const scroll = box.querySelector('ol')?.scrollTop || 0;
    box.dataset.sig = sig;
    box.innerHTML = '';
    const lab = document.createElement('div'); lab.className = 'label'; lab.textContent = 'On repeat · from Kerry’s Spotify';
    const now = document.createElement('div'); now.className = 'now';
    const btn = (txt, title, fn, cls = '') => { const b = document.createElement('button'); b.className = 'btn ctl ' + cls; b.textContent = txt; b.title = title; b.setAttribute('aria-label', title); b.onclick = fn; return b; };
    const txt = document.createElement('div'); txt.className = 'now-txt';
    txt.innerHTML = `<div class="now-t"></div><div class="now-a"></div>`;
    txt.firstChild.textContent = st.on ? cur.title : 'Put a track on the TV';
    txt.lastChild.textContent = st.error ? 'Spotify’s player didn’t load. Try again, or open a track below.' : st.on ? `${cur.artist}${st.buffering ? ' · loading' : st.playing ? ' · playing' : ' · paused'}` : 'Kerry will hear it too.';
    now.append(btn('⏮', 'Previous track', () => music.prev()), btn(st.on && st.playing ? '❚❚' : '▶', st.on && st.playing ? 'Pause' : 'Play on the TV', () => (st.on ? music.toggle() : music.play()), 'main'), btn('⏭', 'Next track', () => music.next()), txt);
    if (st.on) now.append(btn('✕', 'Turn the music off', () => music.stop()));
    const ol = document.createElement('ol');
    music.tracks.forEach((t, i) => {
      const li = document.createElement('li'); if (st.on && i === st.index) li.className = 'cur';
      const b = document.createElement('button'); b.textContent = t.title;
      const sm = document.createElement('small'); sm.textContent = t.artist; b.appendChild(sm);
      b.onclick = () => music.play(i);
      const a = document.createElement('a'); a.href = t.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Spotify ↗'; a.title = `Open ${t.title} in Spotify`;
      li.append(b, a); ol.appendChild(li);
    });
    const fine = document.createElement('p'); fine.className = 'fine';
    fine.textContent = 'Plays through Spotify’s own player: full tracks if you’re signed in to Spotify in this browser, 30-second previews if not.';
    box.append(lab, now, ol, fine);
    ol.scrollTop = scroll;
  }

  // --------------------------------------------------------- picking
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  // invisible boxes stand in for objects, so picking stays cheap
  const pickables = [...proxies];
  const kerryProxy = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1, 10), new THREE.MeshBasicMaterial({ visible: false }));
  kerryProxy.userData.hotspot = 'kerry';
  if (kerry) { scene.add(kerryProxy); pickables.push(kerryProxy); }
  pickables.push(ball.mesh);
  function syncProxies() {
    for (const p of proxies) if (p.userData.follow) p.userData.follow.getWorldPosition(p.position).add(p.userData.offset);
    if (kerry) {
      const a = kerry.capsule.a, b = kerry.capsule.b;
      kerryProxy.position.lerpVectors(a, b, 0.5);
      const len = Math.max(0.4, a.distanceTo(b) + 0.5);
      kerryProxy.scale.set(1, len, 1);
      kerryProxy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      kerryProxy.updateMatrixWorld();
    }
  }
  const tip = $('#tip');
  let hoverId = null, lastMove = 0;
  function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    syncProxies();
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

  // --------------------------------------------------------- tour (spoken + captioned)
  const caption = $('#caption');
  let tourIdx = -1, tourTimer = null, voice = null;
  const synth = window.speechSynthesis || null;
  function pickVoice() {
    if (!synth) return null;
    const vs = synth.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
    const prefer = ['Daniel', 'Google UK English Male', 'Arthur', 'Oliver', 'Microsoft Ryan', 'Microsoft Guy', 'Aaron', 'Alex', 'Google US English'];
    for (const name of prefer) { const v = vs.find((x) => x.name.includes(name)); if (v) return v; }
    return vs.find((v) => /en-GB/i.test(v.lang)) || vs[0] || null;
  }
  if (synth) synth.onvoiceschanged = () => { voice = pickVoice(); };
  function say(text, done) {
    caption.textContent = text;
    caption.classList.add('show');
    const fallback = () => { tourTimer = setTimeout(done, Math.max(3500, text.split(/\s+/).length * 380)); };
    if (!synth || !audio.enabled) { fallback(); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    voice ||= pickVoice();
    if (voice) u.voice = voice;
    u.rate = 1.0; u.pitch = 0.92; u.volume = 1;
    let finished = false;
    const end = () => { if (finished) return; finished = true; tourTimer = setTimeout(done, 650); };
    u.onend = end;
    u.onerror = () => { if (!finished) { finished = true; fallback(); } };
    // some mobile browsers never fire onend; never get stuck
    tourTimer = setTimeout(end, Math.max(6000, text.length * 85));
    synth.speak(u);
  }
  function stopTour() {
    if (!ui.tour) return;
    ui.tour = null; tourIdx = -1;
    clearTimeout(tourTimer); synth?.cancel();
    caption.classList.remove('show');
    $('#tour-btn').textContent = 'Tour';
    $('#tour-btn').setAttribute('aria-pressed', 'false');
  }
  function tourStep() {
    if (!ui.tour) return;
    clearTimeout(tourTimer);
    tourIdx++;
    if (tourIdx >= TOUR.length) { stopTour(); flyTo(HOME.pos, HOME.target); closePanel(); return; }
    const id = TOUR[tourIdx];
    flyToSpot(id);
    if (SPOTS[id]) openPanel(id); else closePanel();
    if (id === 'soko') enableLive();
    let line = TOUR_LINES[id];
    if (typeof line === 'function') {
      const st = (ui.brain?.status || 'around').replace(/^./, (c) => c.toLowerCase()).replace(/ ps5/i, ' PS5').replace(/kerryos/i, 'KerryOS');
      line = line(st);
    }
    say(line, tourStep);
  }
  $('#tour-btn').onclick = () => {
    if (ui.tour) { stopTour(); flyTo(HOME.pos, HOME.target); closePanel(); return; }
    ui.tour = true; tourIdx = -1;
    $('#tour-btn').textContent = 'Stop tour';
    $('#tour-btn').setAttribute('aria-pressed', 'true');
    tourStep();
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

  return Object.assign(ui, { update, renderLive, flyTo, flyToSpot, openPanel, enableLive, cssRenderer, music, setSize(w, h) { cssRenderer.setSize(w, h); } });
}
