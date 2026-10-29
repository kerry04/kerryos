import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ASSETS } from './config.js';
import * as TX from './textures.js';
import { canvas, canvasTexture, shadowAll, rand, makeNoise, lerp } from './util.js';

export const ROOM = { minX: -3.5, maxX: 3.5, minZ: -3, maxZ: 3, H: 2.8, T: 0.15 };
export const WINDOW = { x0: -2.45, x1: -0.65, y0: 1.0, y1: 2.3 };
export const HOOP = { rim: new THREE.Vector3(0.75, 2.3, -2.52), R: 0.23, tube: 0.009, board: { x0: 0.3, x1: 1.2, y0: 2.06, y1: 2.66, z: -2.9 } };

const tl = new THREE.TextureLoader();
function loadTex(url, { srgb = true, repeat = [1, 1], aniso = 8 } = {}) {
  if (!url) return null;
  const t = tl.load(url);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  return t;
}

function rbox(w, h, d, r = 0.01, seg = 2) {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
}

function mesh(geo, mat, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}

export function buildRoom(manager) {
  tl.manager = manager;
  const group = new THREE.Group();
  const colliders = []; // {min, max, rest, fric, soft, nav}
  const hotspots = {};  // id -> Object3D
  const props = {};
  const anchors = {};
  const N = makeNoise(3);

  const addCollider = (min, max, opts = {}) => {
    colliders.push({ min: new THREE.Vector3(...min), max: new THREE.Vector3(...max), rest: opts.rest ?? 0.55, fric: opts.fric ?? 0.5, soft: !!opts.soft, nav: opts.nav ?? true, ball: opts.ball ?? true, rolloff: opts.rolloff ? new THREE.Vector3(...opts.rolloff) : null });
  };
  const hot = (id, obj) => { (hotspots[id] ||= []).push(obj); obj.userData.hotspot = id; return obj; };

  // ---------------------------------------------------------------- materials
  const M = {};
  const anisoMax = 8;
  M.floor = new THREE.MeshStandardMaterial({
    map: loadTex(ASSETS.tex.floor[0], { repeat: [3, 2.6] }),
    normalMap: loadTex(ASSETS.tex.floor[1], { srgb: false, repeat: [3, 2.6] }),
    roughnessMap: loadTex(ASSETS.tex.floor[2], { srgb: false, repeat: [3, 2.6] }),
    roughness: 0.9, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 0.8,
  });
  // painted plaster: keep the plaster's grain (normal + roughness), paint it a warm greige
  M.wall = new THREE.MeshStandardMaterial({
    normalMap: loadTex(ASSETS.tex.wall[1], { srgb: false, repeat: [1.4, 1.4] }),
    roughnessMap: loadTex(ASSETS.tex.wall[2], { srgb: false, repeat: [1.4, 1.4] }),
    color: new THREE.Color('#d6d0c4'), roughness: 0.95, normalScale: new THREE.Vector2(0.55, 0.55), envMapIntensity: 0.5,
  });
  M.wallCut = new THREE.MeshStandardMaterial({ color: '#d9d2c6', roughness: 0.95 });
  M.slab = new THREE.MeshStandardMaterial({ color: '#4a423a', roughness: 0.9 });
  M.trim = new THREE.MeshPhysicalMaterial({ color: '#f1eee8', roughness: 0.42, clearcoat: 0.25, clearcoatRoughness: 0.5 });
  const deskDiff = ASSETS.tex.desk[0] ? loadTex(ASSETS.tex.desk[0]) : TX.woodDiffuse();
  M.deskWood = new THREE.MeshStandardMaterial({
    map: deskDiff, normalMap: loadTex(ASSETS.tex.desk[1], { srgb: false }), roughnessMap: loadTex(ASSETS.tex.desk[2], { srgb: false }),
    roughness: 0.75, normalScale: new THREE.Vector2(0.5, 0.5),
  });
  M.oak = new THREE.MeshStandardMaterial({ map: TX.woodDiffuse(), color: '#c9a27a', roughness: 0.6 });
  M.walnut = new THREE.MeshStandardMaterial({ map: TX.woodDiffuse(), color: '#6e4a33', roughness: 0.55 });
  M.blackMetal = new THREE.MeshStandardMaterial({ color: '#1c1d20', roughness: 0.38, metalness: 0.85, roughnessMap: TX.brushedMetalRough() });
  M.alu = new THREE.MeshStandardMaterial({ color: '#b9bcc0', roughness: 0.3, metalness: 1, roughnessMap: TX.brushedMetalRough() });
  M.chrome = new THREE.MeshStandardMaterial({ color: '#d6d8db', roughness: 0.12, metalness: 1 });
  M.plasticBlack = new THREE.MeshPhysicalMaterial({ color: '#121315', roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 });
  M.plasticMatte = new THREE.MeshStandardMaterial({ color: '#1a1b1e', roughness: 0.75 });
  M.plasticWhite = new THREE.MeshPhysicalMaterial({ color: '#eceeef', roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  M.screenOff = new THREE.MeshPhysicalMaterial({ color: '#050607', roughness: 0.08, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.05 });
  M.fabricDark = new THREE.MeshPhysicalMaterial({ color: '#3a3d3a', roughness: 0.95, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color('#7a7f78'), normalMap: TX.fabricNormal(6), normalScale: new THREE.Vector2(0.4, 0.4) });
  M.sheet = new THREE.MeshPhysicalMaterial({ color: '#e9e6df', roughness: 0.9, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color('#ffffff'), normalMap: TX.wrinkleNormal(), normalScale: new THREE.Vector2(0.5, 0.5) });
  M.duvet = new THREE.MeshPhysicalMaterial({ color: '#33465c', roughness: 0.92, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color('#8fa4bd'), normalMap: TX.wrinkleNormal(), normalScale: new THREE.Vector2(0.9, 0.9) });
  M.knit = new THREE.MeshPhysicalMaterial({ color: '#8b8579', roughness: 1, sheen: 1, sheenColor: new THREE.Color('#d6cfc2'), normalMap: TX.fabricNormal(14), normalScale: new THREE.Vector2(1.2, 1.2) });
  M.curtain = new THREE.MeshPhysicalMaterial({ color: '#b9ad98', roughness: 0.95, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color('#efe6d6'), side: THREE.DoubleSide, normalMap: TX.fabricNormal(10), normalScale: new THREE.Vector2(0.4, 0.4) });
  M.beanbag = new THREE.MeshPhysicalMaterial({ color: '#4b5a46', roughness: 0.85, sheen: 1, sheenRoughness: 0.35, sheenColor: new THREE.Color('#9fb197'), normalMap: TX.fabricNormal(8), normalScale: new THREE.Vector2(0.5, 0.5) });
  M.glass = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.08, envMapIntensity: 1.2, depthWrite: false });
  M.whiteboard = new THREE.MeshPhysicalMaterial({ color: '#efefec', roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.22, envMapIntensity: 0.6 });
  M.ceramic = new THREE.MeshPhysicalMaterial({ color: '#e8e2d8', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  M.terracotta = new THREE.MeshStandardMaterial({ color: '#b56a45', roughness: 0.85 });
  M.soil = new THREE.MeshStandardMaterial({ color: '#2a1f17', roughness: 1 });
  M.rubber = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 });
  M.ledWarm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.82, 0.62).multiplyScalar(2.2), toneMapped: false });
  M.ledGreen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1, 0.5).multiplyScalar(2), toneMapped: false });
  M.ledBlue = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.6, 1).multiplyScalar(2.4), toneMapped: false });
  M.deckShell = new THREE.MeshPhysicalMaterial({ color: '#3b3f38', roughness: 0.62, clearcoat: 0.15, normalMap: TX.pebbleNormal(), normalScale: new THREE.Vector2(0.25, 0.25) });
  M.capDark = new THREE.MeshPhysicalMaterial({ color: '#2b2d31', roughness: 0.55, clearcoat: 0.2 });
  M.capLight = new THREE.MeshPhysicalMaterial({ color: '#d8d3c6', roughness: 0.5, clearcoat: 0.2 });
  M.capAccent = new THREE.MeshPhysicalMaterial({ color: '#c96a2b', roughness: 0.5, clearcoat: 0.2 });
  M.rimOrange = new THREE.MeshStandardMaterial({ color: '#d1451c', roughness: 0.35, metalness: 0.6 });
  props.materials = M;

  // ---------------------------------------------------------------- shell
  const { minX, maxX, minZ, maxZ, H, T } = ROOM;
  // floor + slab
  const floor = mesh(new THREE.PlaneGeometry(maxX - minX, maxZ - minZ), M.floor, 0, 0, 0, group);
  floor.rotation.x = -Math.PI / 2; floor.castShadow = false;
  floor.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  mesh(new THREE.BoxGeometry(maxX - minX + T, 0.18, maxZ - minZ + T), M.slab, (minX + maxX) / 2 - T / 2, -0.09 - 0.001, (minZ + maxZ) / 2 - T / 2, group).castShadow = false;
  // floor edge strip (visible cut)
  mesh(new THREE.BoxGeometry(maxX - minX + T, 0.02, 0.02), M.walnut, (minX + maxX) / 2 - T / 2, -0.01, maxZ, group);
  mesh(new THREE.BoxGeometry(0.02, 0.02, maxZ - minZ + T), M.walnut, maxX, -0.01, (minZ + maxZ) / 2 - T / 2, group);

  // back wall with window opening
  const bz = minZ - T / 2;
  const W = WINDOW;
  const wallPieces = [
    [minX - T, W.x0, 0, H],          // left of window
    [W.x1, maxX, 0, H],              // right of window
    [W.x0, W.x1, 0, W.y0],           // below
    [W.x0, W.x1, W.y1, H],           // above
  ];
  for (const [x0, x1, y0, y1] of wallPieces) {
    const w = x1 - x0, h = y1 - y0;
    const g = new THREE.BoxGeometry(w, h, T);
    // keep plaster texel density constant
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 2.3 + x0 / 2.3, uv.getY(i) * h / 2.3 + y0 / 2.3);
    const m = mesh(g, M.wall, (x0 + x1) / 2, (y0 + y1) / 2, bz, group);
    m.castShadow = true;
  }
  // left wall
  {
    const g = new THREE.BoxGeometry(T, H, maxZ - minZ + T);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (maxZ - minZ) / 2.3, uv.getY(i) * H / 2.3);
    mesh(g, M.wall, minX - T / 2, H / 2, (minZ + maxZ) / 2 - T / 2, group);
  }
  // wall top caps (cut section reads as real wall thickness)
  mesh(new THREE.BoxGeometry(maxX - minX + T, 0.004, T), M.wallCut, (minX + maxX) / 2 - T / 2, H + 0.002, bz, group).castShadow = false;
  mesh(new THREE.BoxGeometry(T, 0.004, maxZ - minZ + T), M.wallCut, minX - T / 2, H + 0.002, (minZ + maxZ) / 2 - T / 2, group).castShadow = false;

  // baseboards
  mesh(new THREE.BoxGeometry(maxX - minX, 0.09, 0.016), M.trim, (minX + maxX) / 2, 0.045, minZ + 0.008, group);
  mesh(new THREE.BoxGeometry(0.016, 0.09, maxZ - minZ), M.trim, minX + 0.008, 0.045, (minZ + maxZ) / 2, group);
  // LED cove strip along top of both walls (warm, dim)
  const ledBack = mesh(new THREE.BoxGeometry(maxX - minX, 0.012, 0.012), M.ledWarm, (minX + maxX) / 2, H - 0.05, minZ + 0.03, group);
  const ledLeft = mesh(new THREE.BoxGeometry(0.012, 0.012, maxZ - minZ), M.ledWarm, minX + 0.03, H - 0.05, (minZ + maxZ) / 2, group);
  ledBack.castShadow = ledLeft.castShadow = false;
  mesh(new THREE.BoxGeometry(maxX - minX, 0.04, 0.05), M.trim, (minX + maxX) / 2, H - 0.025, minZ + 0.025, group);
  mesh(new THREE.BoxGeometry(0.05, 0.04, maxZ - minZ), M.trim, minX + 0.025, H - 0.025, (minZ + maxZ) / 2, group);
  props.ledStrips = [ledBack, ledLeft];

  // outlets + switch
  const plate = (x, y, z, rotY, double = true) => {
    const g = new THREE.Group();
    mesh(rbox(double ? 0.13 : 0.08, 0.08, 0.008, 0.004), M.trim, 0, 0, 0, g);
    if (double) for (const dx of [-0.032, 0.032]) {
      mesh(rbox(0.04, 0.045, 0.004, 0.006), M.plasticWhite, dx, 0, 0.005, g);
      for (const sx of [-0.008, 0.008]) mesh(new THREE.BoxGeometry(0.003, 0.009, 0.002), M.plasticBlack, dx + sx, 0.004, 0.0075, g);
    } else mesh(rbox(0.03, 0.05, 0.008, 0.004), M.plasticWhite, 0, 0, 0.006, g);
    g.position.set(x, y, z); g.rotation.y = rotY; group.add(g);
  };
  plate(-0.95, 0.3, minZ + 0.004, 0);
  plate(minX + 0.004, 0.3, 0.2, Math.PI / 2);
  plate(minX + 0.004, 1.15, 2.7, Math.PI / 2, false);
  plate(2.0, 0.3, minZ + 0.004, 0);

  // ---------------------------------------------------------------- window
  {
    const g = new THREE.Group();
    const fw = 0.05;
    const wx = (W.x0 + W.x1) / 2, wy = (W.y0 + W.y1) / 2, ww = W.x1 - W.x0, wh = W.y1 - W.y0;
    // reveal (inner jamb) lining the wall thickness
    mesh(new THREE.BoxGeometry(ww, 0.01, T), M.wallCut, wx, W.y1 - 0.005, bz, g);
    mesh(new THREE.BoxGeometry(0.01, wh, T), M.wallCut, W.x0 + 0.005, wy, bz, g);
    mesh(new THREE.BoxGeometry(0.01, wh, T), M.wallCut, W.x1 - 0.005, wy, bz, g);
    // frame (aluminium, dark bronze)
    const frameMat = new THREE.MeshStandardMaterial({ color: '#2b2722', roughness: 0.4, metalness: 0.7 });
    const fz = bz - 0.02;
    mesh(new THREE.BoxGeometry(ww, fw, 0.06), frameMat, wx, W.y1 - fw / 2, fz, g);
    mesh(new THREE.BoxGeometry(ww, fw, 0.06), frameMat, wx, W.y0 + fw / 2, fz, g);
    mesh(new THREE.BoxGeometry(fw, wh, 0.06), frameMat, W.x0 + fw / 2, wy, fz, g);
    mesh(new THREE.BoxGeometry(fw, wh, 0.06), frameMat, W.x1 - fw / 2, wy, fz, g);
    mesh(new THREE.BoxGeometry(0.035, wh, 0.05), frameMat, wx, wy, fz, g);
    mesh(new THREE.BoxGeometry(ww, 0.03, 0.05), frameMat, wx, W.y0 + wh * 0.72, fz, g);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(ww - 0.04, wh - 0.04), M.glass);
    glass.position.set(wx, wy, fz + 0.005); g.add(glass);
    // sill
    mesh(rbox(ww + 0.16, 0.03, 0.2, 0.008), M.trim, wx, W.y0 - 0.015, minZ + 0.06, g);
    // curtain rod + curtains
    mesh(new THREE.CylinderGeometry(0.012, 0.012, ww + 0.9, 16), M.blackMetal, wx, W.y1 + 0.17, minZ + 0.1, g).rotation.z = Math.PI / 2;
    for (const end of [-1, 1]) mesh(new THREE.SphereGeometry(0.022, 16, 12), M.blackMetal, wx + end * (ww / 2 + 0.45), W.y1 + 0.17, minZ + 0.1, g);
    const curtainGeo = (w, h) => {
      const geo = new THREE.PlaneGeometry(w, h, 40, 30);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i);
        const t = (y + h / 2) / h; // 0 bottom .. 1 top
        const fold = Math.sin((x / w) * Math.PI * 9) * 0.035 * (0.7 + 0.3 * (1 - t));
        p.setZ(i, fold + N.n2(x * 4, y * 3) * 0.006);
        p.setX(i, x * (1 - 0.12 * (1 - t) * (1 - t)));
      }
      geo.computeVertexNormals();
      return geo;
    };
    const ch = W.y1 + 0.15 - 0.15;
    const cL = mesh(curtainGeo(0.5, ch), M.curtain, W.x0 - 0.12, (W.y1 + 0.15 + 0.15) / 2, minZ + 0.11, g);
    const cR = mesh(curtainGeo(0.5, ch), M.curtain, W.x1 + 0.12, (W.y1 + 0.15 + 0.15) / 2, minZ + 0.11, g);
    props.curtains = [cL, cR];
    group.add(g);
    hot('window', glass);
    props.windowGlass = glass;
  }

  // ---------------------------------------------------------------- desk
  {
    const g = new THREE.Group();
    const x0 = -2.75, x1 = -0.85, d = 0.75, top = 0.75;
    const cx = (x0 + x1) / 2, cz = minZ + d / 2 + 0.02;
    mesh(rbox(x1 - x0, 0.035, d, 0.006), M.deskWood, cx, top - 0.0175, cz, g);
    // steel frame: two C-legs + crossbar
    for (const lx of [x0 + 0.08, x1 - 0.08]) {
      mesh(new THREE.BoxGeometry(0.05, top - 0.035, 0.05), M.blackMetal, lx, (top - 0.035) / 2, cz, g);
      mesh(new THREE.BoxGeometry(0.06, 0.03, d - 0.08), M.blackMetal, lx, 0.015, cz, g);
      mesh(new THREE.BoxGeometry(0.06, 0.03, d - 0.12), M.blackMetal, lx, top - 0.05, cz, g);
    }
    mesh(new THREE.BoxGeometry(x1 - x0 - 0.2, 0.06, 0.02), M.blackMetal, cx, top - 0.08, minZ + 0.08, g);
    // cable tray
    mesh(new THREE.BoxGeometry(0.9, 0.06, 0.12), M.blackMetal, cx, top - 0.12, minZ + 0.14, g);
    // desk mat
    const matTex = (() => { const [c, x] = canvas(256, 128); x.fillStyle = '#26282b'; x.fillRect(0, 0, 256, 128); x.fillStyle = 'rgba(255,255,255,0.03)'; for (let i = 0; i < 4000; i++) x.fillRect(Math.random() * 256, Math.random() * 128, 1, 1); return canvasTexture(c); })();
    mesh(rbox(0.8, 0.004, 0.36, 0.002), new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.95 }), -1.6, top + 0.002, -2.43, g).castShadow = false;
    group.add(g);
    addCollider([x0, 0, minZ], [x1, top, minZ + d + 0.02], { rest: 0.45 });
    anchors.deskTop = top;

    // main monitor (SokoResult) — 27", 16:9
    const mon = new THREE.Group();
    const sw = 0.62, sh = 0.349;
    mesh(rbox(sw + 0.014, sh + 0.016, 0.022, 0.004), M.plasticBlack, 0, 0, -0.012, mon);
    mesh(rbox(sw * 0.98, sh * 0.9, 0.03, 0.01), M.plasticMatte, 0, 0, -0.035, mon);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ color: '#0d0f12', toneMapped: false }));
    screen.position.z = 0.0002; mon.add(screen);
    // stand
    mesh(new THREE.BoxGeometry(0.05, 0.3, 0.02), M.alu, 0, -0.2, -0.06, mon);
    mesh(rbox(0.24, 0.012, 0.18, 0.004), M.alu, 0, -sh / 2 - 0.25 + 0.006 - 0.0, -0.03, mon);
    mon.position.set(-1.6, top + 0.25 + sh / 2 + 0.015, -2.82);
    group.add(mon);
    props.sokoScreen = screen; props.sokoSize = [sw, sh];
    hot('soko', screen); hot('soko', mon.children[0]);

    // portrait monitor (Soko Stock)
    const mon2 = new THREE.Group();
    const s2w = 0.3, s2h = 0.52;
    mesh(rbox(s2w + 0.014, s2h + 0.014, 0.02, 0.004), M.plasticBlack, 0, 0, -0.011, mon2);
    const scr2 = new THREE.Mesh(new THREE.PlaneGeometry(s2w, s2h), new THREE.MeshBasicMaterial({ toneMapped: false }));
    scr2.position.z = 0.0003; mon2.add(scr2);
    mesh(new THREE.BoxGeometry(0.04, 0.2, 0.02), M.alu, 0, -s2h / 2 - 0.05, -0.05, mon2);
    mesh(rbox(0.18, 0.01, 0.15, 0.004), M.alu, 0, -s2h / 2 - 0.145, -0.03, mon2);
    mon2.position.set(-2.38, top + 0.15 + s2h / 2, -2.68);
    mon2.rotation.y = 0.42;
    group.add(mon2);
    props.stockScreen = scr2;
    hot('stock', scr2);

    // cyberdeck
    const deck = buildCyberdeck(M);
    deck.group.position.set(-1.6, top, -2.42);
    group.add(deck.group);
    props.deck = deck;
    hot('deck', deck.group);

    // desk lamp (articulated) with real spotlight
    const lamp = new THREE.Group();
    mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.02, 32), M.blackMetal, 0, 0.01, 0, lamp);
    const arm1 = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.38, 12), M.blackMetal, 0, 0.2, 0, lamp);
    arm1.rotation.z = 0.25; arm1.position.x = -0.045;
    const arm2 = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.34, 12), M.blackMetal, -0.17, 0.42, 0, lamp);
    arm2.rotation.z = 1.25;
    const head = mesh(new THREE.ConeGeometry(0.065, 0.12, 32, 1, true), M.blackMetal, -0.33, 0.4, 0, lamp);
    head.rotation.z = -0.9;
    const bulb = mesh(new THREE.SphereGeometry(0.022, 16, 12), M.ledWarm, -0.32, 0.38, 0, lamp);
    bulb.castShadow = false;
    lamp.position.set(-0.98, top, -2.82);
    lamp.rotation.y = -1.1;
    group.add(lamp);
    bulb.userData.dynamic = true;
    props.deskLamp = { group: lamp, bulb };

    // mug
    const mug = new THREE.Group();
    const mugGeo = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.038, 0), new THREE.Vector2(0.04, 0.005), new THREE.Vector2(0.04, 0.095), new THREE.Vector2(0.036, 0.095), new THREE.Vector2(0.036, 0.008), new THREE.Vector2(0, 0.008)], 32);
    mesh(mugGeo, M.ceramic, 0, 0, 0, mug);
    mesh(new THREE.TorusGeometry(0.025, 0.006, 8, 20, Math.PI), M.ceramic, 0.04, 0.05, 0, mug).rotation.z = -Math.PI / 2;
    mesh(new THREE.CircleGeometry(0.035, 24), new THREE.MeshStandardMaterial({ color: '#2b160c', roughness: 0.15 }), 0, 0.075, 0, mug).rotation.x = -Math.PI / 2;
    mug.position.set(-1.08, top, -2.38);
    group.add(mug);

    // headphones on a hook under the desk edge
    const hp = new THREE.Group();
    mesh(new THREE.TorusGeometry(0.085, 0.01, 10, 32, Math.PI), M.plasticBlack, 0, 0, 0, hp);
    for (const s of [-1, 1]) mesh(rbox(0.03, 0.085, 0.07, 0.012), M.plasticBlack, s * 0.085, -0.02, 0, hp);
    hp.position.set(-2.62, top - 0.15, -2.24); hp.rotation.y = Math.PI / 2;
    group.add(hp);

    // chair
    const chair = buildChair(M);
    chair.position.set(-1.6, 0, -1.85);
    chair.rotation.y = Math.PI;
    group.add(chair);
    props.chair = chair;
    addCollider([-1.9, 0, -2.15], [-1.3, 0.55, -1.55], { rest: 0.35, nav: true });
    anchors.coding = { approach: new THREE.Vector3(-1.6, 0, -1.3), seat: new THREE.Vector3(-1.6, 0.47, -1.83), facing: Math.PI };
  }

  // ---------------------------------------------------------------- server rack (KerryOS host)
  {
    const rack = buildRack(M);
    rack.group.position.set(-0.35, 0, -2.71);
    group.add(rack.group);
    props.rack = rack;
    hot('rack', rack.group);
    addCollider([-0.64, 0, minZ], [-0.06, 1.22, -2.42], { rest: 0.4 });
    anchors.rack = { approach: new THREE.Vector3(-0.35, 0, -2.0), facing: Math.PI };
  }

  // ---------------------------------------------------------------- hoop
  {
    const g = new THREE.Group();
    const B = HOOP.board;
    const bw = B.x1 - B.x0, bh = B.y1 - B.y0;
    const [c, x] = canvas(512, 340);
    x.fillStyle = '#f4f5f5'; x.fillRect(0, 0, 512, 340);
    x.strokeStyle = '#d1451c'; x.lineWidth = 10; x.strokeRect(10, 10, 492, 320);
    x.lineWidth = 9; x.strokeRect(176, 150, 160, 120);
    const boardMat = new THREE.MeshPhysicalMaterial({ map: canvasTexture(c), roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    mesh(rbox(bw, bh, 0.025, 0.01), boardMat, (B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2, B.z, g);
    // wall bracket
    for (const s of [-0.25, 0.25]) mesh(new THREE.BoxGeometry(0.035, 0.035, 0.09), M.blackMetal, (B.x0 + B.x1) / 2 + s, (B.y0 + B.y1) / 2, minZ + 0.045, g);
    // rim + mount plate
    const rim = mesh(new THREE.TorusGeometry(HOOP.R, HOOP.tube, 12, 64), M.rimOrange, HOOP.rim.x, HOOP.rim.y, HOOP.rim.z, g);
    rim.rotation.x = Math.PI / 2;
    mesh(new THREE.BoxGeometry(0.16, 0.12, 0.012), M.rimOrange, HOOP.rim.x, HOOP.rim.y - 0.05, B.z + 0.018, g);
    for (const s of [-1, 1]) {
      const strut = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.17, 8), M.rimOrange, HOOP.rim.x + s * 0.05, HOOP.rim.y - 0.035, B.z + 0.09, g);
      strut.rotation.x = Math.PI / 2 - 0.45;
    }
    // net hooks
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      mesh(new THREE.TorusGeometry(0.008, 0.002, 4, 8), M.chrome, HOOP.rim.x + Math.cos(a) * HOOP.R, HOOP.rim.y - 0.006, HOOP.rim.z + Math.sin(a) * HOOP.R, g).castShadow = false;
    }
    group.add(g);
    hot('hoop', rim); hot('hoop', g.children[0]);
    props.rim = rim;
  }

  // ---------------------------------------------------------------- bed corner
  {
    const g = new THREE.Group();
    const x0 = 1.85, x1 = 3.38, z0 = minZ + 0.04, z1 = -0.84;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, bw = x1 - x0, bl = z1 - z0;
    // platform frame
    mesh(rbox(bw, 0.28, bl, 0.015), M.oak, cx, 0.16, cz, g);
    for (const [lx, lz] of [[x0 + 0.06, z1 - 0.06], [x1 - 0.06, z1 - 0.06]]) mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.04, 12), M.walnut, lx, 0.02, lz, g);
    // upholstered headboard with tufting
    const hb = mesh(rbox(bw + 0.06, 0.62, 0.08, 0.03, 3), new THREE.MeshPhysicalMaterial({ color: '#6b6258', roughness: 0.95, sheen: 1, sheenColor: new THREE.Color('#b8ab9b'), normalMap: TX.fabricNormal(5), normalScale: new THREE.Vector2(0.6, 0.6) }), cx, 0.62, minZ + 0.05, g);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) mesh(new THREE.SphereGeometry(0.012, 8, 6), M.fabricDark, x0 + 0.18 + i * (bw - 0.36) / 4, 0.52 + j * 0.2, minZ + 0.093, g).castShadow = false;
    // mattress
    const mattress = mesh(rbox(bw - 0.08, 0.22, bl - 0.08, 0.06, 4), M.sheet, cx, 0.41, cz + 0.02, g);
    // pillows
    for (const px of [cx - 0.33, cx + 0.33]) {
      const pg = rbox(0.6, 0.13, 0.4, 0.06, 4);
      const pp = pg.attributes.position;
      for (let i = 0; i < pp.count; i++) {
        const X = pp.getX(i) / 0.3, Z = pp.getZ(i) / 0.2;
        const k = Math.max(0, 1 - X * X * 0.7 - Z * Z * 0.7);
        pp.setY(i, pp.getY(i) * (0.45 + 0.75 * k));
      }
      pg.computeVertexNormals();
      const pm = mesh(pg, M.sheet, px, 0.565, minZ + 0.32, g);
      pm.rotation.x = -0.2;
    }
    // duvet: a cloth surface that drapes over the mattress edges and, when
    // Kerry sleeps, over the shape of his body (chest down), folded at the top
    const mTop = 0.52;
    const drape = 0.26, footDrape = 0.22;
    const UW = 56, VL = 72;
    const duvetGeo = new THREE.PlaneGeometry(1, 1, UW, VL);
    const duvetMat = M.duvet.clone(); duvetMat.side = THREE.DoubleSide;
    const duvet = new THREE.Mesh(duvetGeo, duvetMat);
    duvet.castShadow = true; duvet.receiveShadow = true;
    g.add(duvet);
    const bodyX = cx;
    const seg = (z, za, zb, w, h, sx) => {
      const zc = Math.min(Math.max(z, za), zb);
      const dz = Math.abs(z - zc);
      const lat = Math.abs(sx);
      const fz = Math.max(0, 1 - dz / 0.16);
      const fl = 1 - Math.min(1, Math.max(0, (lat - w * 0.55) / (w * 0.45 + 0.16)));
      return h * fz * (fl * fl * (3 - 2 * fl));
    };
    const bump = (sx, z) => Math.max(
      seg(z, -2.2, -1.62, 0.34, 0.22, sx),
      seg(z, -1.62, -1.3, 0.3, 0.21, sx),
      seg(z, -1.3, -1.06, 0.24, 0.19, sx),
      seg(z, -1.06, -0.96, 0.22, 0.17, sx),
      seg(z, -1.25, -0.93, 0.15, 0.26, sx - 0.1), seg(z, -1.25, -0.93, 0.15, 0.26, sx + 0.1)
    );
    function setCover(t) {
      const p = duvetGeo.attributes.position;
      const zTop = lerp(-2.2, -2.08, t);
      const Wc = bw + 2 * drape, Lc = (z1 - zTop) + footDrape;
      for (let j = 0; j <= VL; j++) {
        const v = j / VL;
        const along = v * Lc; // from the top edge toward the foot
        let z = zTop + along, yFoot = 0;
        if (z > z1) { yFoot = -(z - z1); z = z1 + 0.02 * Math.min(1, (z - z1) / 0.04); }
        for (let i = 0; i <= UW; i++) {
          const u = i / UW;
          const sx = (u - 0.5) * Wc;
          let x, y;
          const wr = N.fbm(sx * 3.1 + 0.37, z * 2.7 + 0.61, 3) * 0.018 + N.n2(sx * 9 + 0.29, z * 7 + 0.53) * 0.004;
          const fold = Math.exp(-along / 0.07) * 0.03 + (along < 0.18 ? 0.012 : 0);
          if (Math.abs(sx) <= bw / 2) {
            x = cx + sx;
            y = mTop + 0.045 + bump(sx, z) * t + wr + fold;
          } else {
            const d = Math.abs(sx) - bw / 2;
            x = cx + Math.sign(sx) * (bw / 2 + 0.035 * Math.min(1, d / 0.06) + d * 0.04);
            y = mTop + 0.045 - d * 0.95 + wr * 0.6 + fold * 0.5;
          }
          if (yFoot < 0) y = Math.min(y, mTop + 0.045 + yFoot * 0.95 + wr * 0.5);
          p.setXYZ(j * (UW + 1) + i, x, y, z);
        }
      }
      p.needsUpdate = true;
      duvetGeo.computeVertexNormals();
      duvetGeo.computeBoundingSphere();
    }
    setCover(0);
    // throw blanket lying across the foot of the duvet
    const throwM = mesh(rbox(bw + 0.06, 0.022, 0.4, 0.01, 3), M.knit, cx, mTop + 0.075, z1 - 0.3, g);
    group.add(g);
    duvet.userData.dynamic = true; throwM.userData.dynamic = true;
    props.bed = { duvet, setCover, mattress, throwM, throwY: throwM.position.y };
    hot('bed', mattress); hot('bed', duvet);
    addCollider([x0, 0, minZ], [maxX, 0.6, z1 + 0.02], { rest: 0.25, soft: true, rolloff: [-1, 0, 0.35] });
    anchors.sleep = { approach: new THREE.Vector3(1.55, 0, -1.65), lie: new THREE.Vector3(2.62, 0.6, -1.7), facing: 0 };
    anchors.guitar = { approach: new THREE.Vector3(2.62, 0, -0.38), seat: new THREE.Vector3(2.62, 0.56, -1.02), facing: 0 };

    // nightstand + lamp
    const ns = new THREE.Group();
    mesh(rbox(0.44, 0.5, 0.38, 0.012), M.oak, 0, 0.27, 0, ns);
    mesh(new THREE.BoxGeometry(0.4, 0.004, 0.002), M.walnut, 0, 0.36, 0.191, ns);
    mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 8), M.chrome, 0, 0.42, 0.2, ns).rotation.z = Math.PI / 2;
    for (const [lx, lz] of [[-0.18, -0.15], [0.18, -0.15], [-0.18, 0.15], [0.18, 0.15]]) mesh(new THREE.CylinderGeometry(0.012, 0.009, 0.02, 8), M.walnut, lx, 0.01, lz, ns);
    const lampBase = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.06, 0), new THREE.Vector2(0.075, 0.05), new THREE.Vector2(0.07, 0.13), new THREE.Vector2(0.03, 0.2), new THREE.Vector2(0.012, 0.25), new THREE.Vector2(0, 0.25)], 32);
    mesh(lampBase, M.ceramic, 0.04, 0.52, -0.04, ns);
    const shadeMat = new THREE.MeshPhysicalMaterial({ color: '#efe5d3', roughness: 0.9, side: THREE.DoubleSide, emissive: new THREE.Color('#ffc58a'), emissiveIntensity: 0.0, transmission: 0 });
    const shade = mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.18, 40, 1, true), shadeMat, 0.04, 0.84, -0.04, ns);
    shade.castShadow = false;
    ns.position.set(1.55, 0, minZ + 0.25);
    group.add(ns);
    props.bedLamp = { shade, pos: new THREE.Vector3(1.59, 0.84, minZ + 0.21) };
    addCollider([1.33, 0, minZ], [1.77, 0.55, minZ + 0.44], { rest: 0.4 });

    // framed shirt above the bed
    const frame = new THREE.Group();
    mesh(rbox(0.82, 0.92, 0.06, 0.006), M.walnut, 0, 0, 0, frame);
    mesh(new THREE.BoxGeometry(0.74, 0.84, 0.01), new THREE.MeshStandardMaterial({ color: '#1d2433', roughness: 0.95 }), 0, 0, 0.026, frame);
    const shirt = new THREE.Shape();
    shirt.moveTo(-0.12, 0.33); shirt.quadraticCurveTo(0, 0.28, 0.12, 0.33);
    shirt.lineTo(0.3, 0.24); shirt.lineTo(0.33, 0.06); shirt.lineTo(0.22, 0.04);
    shirt.lineTo(0.21, -0.36); shirt.lineTo(-0.21, -0.36); shirt.lineTo(-0.22, 0.04);
    shirt.lineTo(-0.33, 0.06); shirt.lineTo(-0.3, 0.24); shirt.lineTo(-0.12, 0.33);
    const shirtGeo = new THREE.ExtrudeGeometry(shirt, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 4, curveSegments: 16 });
    // map UVs to the jersey texture (shape spans -0.33..0.33 x, -0.36..0.33 y)
    const uv = shirtGeo.attributes.uv, pos = shirtGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + 0.26) / 0.52, (pos.getY(i) + 0.36) / 0.69);
    const shirtMat = new THREE.MeshPhysicalMaterial({ map: TX.jersey('OBAI', '10'), roughness: 0.75, sheen: 0.8, sheenColor: new THREE.Color('#d7ecff'), normalMap: TX.fabricNormal(12), normalScale: new THREE.Vector2(0.3, 0.3) });
    mesh(shirtGeo, shirtMat, 0, 0.02, 0.028, frame);
    const fglass = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.86), M.glass);
    fglass.position.z = 0.062; frame.add(fglass);
    frame.position.set(2.62, 1.92, minZ + 0.035);
    group.add(frame);
    hot('jersey', frame);
  }

  // ---------------------------------------------------------------- guitar on its stand
  {
    const guitar = buildGuitar(M);
    const stand = new THREE.Group();
    for (const s of [-1, 1]) {
      const leg = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.62, 8), M.blackMetal, s * 0.1, 0.29, 0.05, stand);
      leg.rotation.z = s * 0.18; leg.rotation.x = 0.1;
    }
    mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.28, 8), M.blackMetal, 0, 0.12, -0.12, stand).rotation.x = 0.7;
    mesh(new THREE.BoxGeometry(0.3, 0.02, 0.05), M.rubber, 0, 0.22, 0.09, stand);
    stand.position.set(1.42, 0, -0.42);
    stand.rotation.y = 0.6;
    group.add(stand);
    guitar.group.position.set(1.42, 0.53, -0.4);
    guitar.group.rotation.set(-0.15, 0.6, 0);
    group.add(guitar.group);
    props.guitar = guitar;
    guitar.group.userData.dynamic = true;
    props.guitarRest = { pos: guitar.group.position.clone(), rot: guitar.group.rotation.clone() };
    hot('guitar', guitar.body);
    addCollider([1.25, 0, -0.6], [1.6, 1.0, -0.22], { rest: 0.3, nav: true });
  }

  // ---------------------------------------------------------------- media wall (left wall)
  {
    const g = new THREE.Group();
    // credenza
    const cz = 1.05, len = 1.62, dep = 0.42, h = 0.46;
    const credenza = mesh(rbox(dep, h - 0.08, len, 0.01), M.walnut, minX + dep / 2, 0.08 + (h - 0.08) / 2, cz, g);
    // fluted doors
    for (let i = 0; i < 28; i++) mesh(new THREE.CylinderGeometry(0.009, 0.009, h - 0.14, 8), M.walnut, minX + dep + 0.002, 0.08 + (h - 0.08) / 2, cz - len / 2 + 0.06 + i * ((len - 0.12) / 27), g).castShadow = false;
    for (const [lz] of [[cz - len / 2 + 0.1], [cz + len / 2 - 0.1]]) for (const lx of [minX + 0.08, minX + dep - 0.08]) mesh(new THREE.CylinderGeometry(0.015, 0.01, 0.08, 10), M.blackMetal, lx, 0.04, lz, g);
    addCollider([minX, 0, cz - len / 2], [minX + dep, h, cz + len / 2], { rest: 0.45 });

    // TV (65")
    const tv = new THREE.Group();
    const tw = 1.45, th = 0.816;
    mesh(rbox(tw + 0.012, th + 0.012, 0.028, 0.004), M.plasticBlack, 0, 0, -0.014, tv);
    const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(tw, th), new THREE.MeshBasicMaterial({ toneMapped: false }));
    tvScreen.position.z = 0.0003; tv.add(tvScreen);
    const tvGloss = new THREE.Mesh(new THREE.PlaneGeometry(tw, th), new THREE.MeshPhysicalMaterial({ color: '#000', transparent: true, opacity: 0.12, roughness: 0.05, clearcoat: 1, depthWrite: false }));
    tvGloss.position.z = 0.0008; tv.add(tvGloss);
    tv.position.set(minX + 0.05, 1.3, cz);
    tv.rotation.y = Math.PI / 2;
    g.add(tv);
    props.tvScreen = tvScreen; props.tvCenter = new THREE.Vector3(minX + 0.06, 1.3, cz); props.tvSize = [tw, th];
    hot('tv', tvScreen);

    // soundbar
    const sb = mesh(rbox(0.09, 0.07, 0.9, 0.025, 3), M.fabricDark, minX + 0.2, h + 0.035, cz, g);
    const sbLed = mesh(new THREE.BoxGeometry(0.002, 0.004, 0.04), M.ledWarm, minX + 0.246, h + 0.02, cz, g);
    sbLed.castShadow = false;
    props.soundbar = { mesh: sb, led: sbLed, pos: new THREE.Vector3(minX + 0.25, h + 0.04, cz) };
    // subwoofer on the floor with a visible driver
    const sub = new THREE.Group();
    mesh(rbox(0.32, 0.36, 0.32, 0.01), M.plasticBlack, 0, 0.18, 0, sub);
    const cone = mesh(new THREE.CylinderGeometry(0.11, 0.06, 0.03, 32, 1, true), M.rubber, 0.16, 0.18, 0, sub);
    cone.rotation.z = Math.PI / 2;
    const cap = mesh(new THREE.SphereGeometry(0.035, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.plasticMatte, 0.17, 0.18, 0, sub);
    cap.rotation.z = -Math.PI / 2;
    sub.position.set(minX + 0.2, 0, cz + len / 2 + 0.3);
    g.add(sub);
    cone.userData.dynamic = cap.userData.dynamic = true;
    props.subwoofer = { cone, cap, coneX: cone.position.x, capX: cap.position.x };
    addCollider([minX, 0, cz + len / 2 + 0.14], [minX + 0.36, 0.36, cz + len / 2 + 0.46], { rest: 0.5 });

    // console (tall, two-tone) — generic, no branding
    const ps = new THREE.Group();
    const shellShape = new THREE.Shape();
    shellShape.moveTo(0, 0); shellShape.lineTo(0.104, 0); shellShape.quadraticCurveTo(0.12, 0.2, 0.09, 0.39); shellShape.quadraticCurveTo(0.03, 0.405, 0, 0.39); shellShape.lineTo(0, 0);
    const shellGeo = new THREE.ExtrudeGeometry(shellShape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3, curveSegments: 24 });
    for (const s of [-1, 1]) {
      const sh = mesh(shellGeo, M.plasticWhite, -0.06, 0.01, s * 0.05 - (s > 0 ? 0 : 0.012), ps);
    }
    mesh(rbox(0.1, 0.37, 0.088, 0.008), M.plasticBlack, -0.005, 0.2, 0, ps);
    const psLed = mesh(new THREE.BoxGeometry(0.002, 0.3, 0.004), M.ledBlue, 0.046, 0.2, 0.046, ps);
    psLed.castShadow = false;
    mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 24), M.plasticBlack, 0, 0.005, 0, ps);
    ps.position.set(minX + 0.24, h, cz + 0.62);
    g.add(ps);
    psLed.userData.dynamic = true;
    props.consoleLed = psLed;

    // controller (rests on the credenza until Kerry picks it up)
    const pad = buildController(M);
    pad.position.set(minX + 0.3, h + 0.02, cz - 0.55);
    pad.rotation.y = 1.9;
    g.add(pad);
    props.controller = pad;
    pad.userData.dynamic = true;
    props.controllerRest = { pos: pad.position.clone(), rot: pad.rotation.clone() };

    // shelf above the TV
    mesh(rbox(0.22, 0.035, 1.3, 0.004), M.oak, minX + 0.11, 2.02, cz, g);
    // game cases
    const caseCols = ['#1d3b6b', '#1d3b6b', '#2a2a2e', '#1d3b6b', '#3a1d1d', '#1d3b6b'];
    caseCols.forEach((col, i) => {
      const cs = mesh(rbox(0.135, 0.17, 0.014, 0.002), new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.4, clearcoat: 0.5 }), minX + 0.1, 2.0375 + 0.085, cz - 0.6 + i * 0.016, g);
      cs.rotation.x = i === 5 ? 0.18 : 0;
    });
    // mini PC (Virtual Web PC)
    const mini = new THREE.Group();
    mesh(rbox(0.12, 0.04, 0.12, 0.008), M.alu, 0, 0.02, 0, mini);
    mesh(new THREE.BoxGeometry(0.002, 0.004, 0.012), M.ledBlue, 0.061, 0.03, 0.04, mini).castShadow = false;
    mini.position.set(minX + 0.11, 2.0375, cz - 0.1);
    g.add(mini);
    hot('shelf', mini);
    // small trophy
    const trophy = new THREE.Group();
    mesh(new THREE.BoxGeometry(0.06, 0.03, 0.06), M.walnut, 0, 0.015, 0, trophy);
    const cupGeo = new THREE.LatheGeometry([new THREE.Vector2(0.008, 0), new THREE.Vector2(0.008, 0.05), new THREE.Vector2(0.03, 0.08), new THREE.Vector2(0.034, 0.12), new THREE.Vector2(0.03, 0.12)], 24);
    mesh(cupGeo, new THREE.MeshStandardMaterial({ color: '#c9a43a', metalness: 1, roughness: 0.25 }), 0, 0.03, 0, trophy);
    trophy.position.set(minX + 0.1, 2.0375, cz + 0.2);
    g.add(trophy);
    // Kenyan flag on a desk stand
    const flag = new THREE.Group();
    mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.2, 6), M.chrome, 0, 0.1, 0, flag);
    mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.01, 16), M.blackMetal, 0, 0.005, 0, flag);
    const [fc, fx] = canvas(150, 100);
    [['#000000', 0, 30], ['#ffffff', 30, 5], ['#b8102b', 35, 30], ['#ffffff', 65, 5], ['#006b3f', 70, 30]].forEach(([col, y, hh]) => { fx.fillStyle = col; fx.fillRect(0, y, 150, hh); });
    fx.fillStyle = '#b8102b'; fx.beginPath(); fx.ellipse(75, 50, 14, 32, 0, 0, Math.PI * 2); fx.fill();
    fx.fillStyle = '#000'; fx.beginPath(); fx.ellipse(75, 50, 6, 26, 0, 0, Math.PI * 2); fx.fill();
    const flagGeo = new THREE.PlaneGeometry(0.12, 0.08, 10, 1);
    const fp = flagGeo.attributes.position;
    for (let i = 0; i < fp.count; i++) fp.setZ(i, Math.sin((fp.getX(i) + 0.06) * 30) * 0.006);
    flagGeo.computeVertexNormals();
    const flagM = mesh(flagGeo, new THREE.MeshStandardMaterial({ map: canvasTexture(fc), side: THREE.DoubleSide, roughness: 0.8 }), 0.06, 0.16, 0, flag);
    flag.position.set(minX + 0.1, 2.0375, cz + 0.5);
    flag.rotation.y = Math.PI / 2;
    g.add(flag);
    // a small succulent
    const pot = new THREE.Group();
    mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.07, 24), M.ceramic, 0, 0.035, 0, pot);
    for (let i = 0; i < 9; i++) {
      const l = mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshStandardMaterial({ color: '#6f8f6a', roughness: 0.6 }), Math.cos(i * 2.4) * 0.018, 0.075 + (i % 3) * 0.008, Math.sin(i * 2.4) * 0.018, pot);
      l.scale.set(0.6, 1.1, 0.6); l.rotation.z = Math.cos(i * 2.4) * 0.6; l.rotation.x = Math.sin(i * 2.4) * 0.6;
    }
    pot.position.set(minX + 0.1, 2.0375, cz + 0.58);
    g.add(pot);
    group.add(g);
    hot('shelf', trophy);

    // whiteboard
    const wb = new THREE.Group();
    const bw = 1.5, bh = 1.0;
    mesh(rbox(bw + 0.04, bh + 0.04, 0.02, 0.006), M.alu, 0, 0, 0, wb);
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), M.whiteboard.clone());
    surf.position.z = 0.011; wb.add(surf); surf.receiveShadow = true;
    mesh(new THREE.BoxGeometry(0.5, 0.025, 0.06), M.alu, 0.3, -bh / 2 - 0.03, 0.03, wb);
    const markerCols = ['#1d4ed8', '#111111', '#b91c1c'];
    markerCols.forEach((col, i) => {
      const mk = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 10), new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.4, clearcoat: 0.5 }), 0.18 + i * 0.05, -bh / 2 - 0.012, 0.04, wb);
      mk.rotation.z = Math.PI / 2;
    });
    wb.position.set(minX + 0.012, 1.48, -1.2);
    wb.rotation.y = Math.PI / 2;
    group.add(wb);
    props.whiteboard = surf;
    hot('board', surf);
    anchors.board = { approach: new THREE.Vector3(minX + 0.47, 0, -1.25), facing: -Math.PI / 2 };

    // poster frame near the desk corner
    const pf = new THREE.Group();
    mesh(rbox(0.64, 0.92, 0.025, 0.004), M.plasticBlack, 0, 0, 0, pf);
    const posterTex = ASSETS.poster ? loadTex(ASSETS.poster) : TX.posterFallback();
    if (posterTex) { posterTex.wrapS = posterTex.wrapT = THREE.ClampToEdgeWrapping; }
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.88), new THREE.MeshStandardMaterial({ map: posterTex, roughness: 0.6 }));
    poster.position.z = 0.0135; pf.add(poster);
    const pglass = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.88), M.glass); pglass.position.z = 0.016; pf.add(pglass);
    pf.position.set(minX + 0.015, 1.72, -2.42);
    pf.rotation.y = Math.PI / 2;
    group.add(pf);
    hot('poster', poster);

    // bean bag
    const bbGeo = new THREE.SphereGeometry(0.5, 64, 40);
    {
      const p = bbGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        y = y < 0 ? y * 0.3 : y * 0.5;
        // seat dent toward the TV side, raised back rest behind
        const dx = x + 0.1, dz = z;
        const dent = Math.exp(-(dx * dx + dz * dz) * 8) * 0.13;
        y -= dent * (y > 0 ? 1 : 0);
        y += (x > 0.12 ? 0.22 * Math.max(0, y) * Math.min(1, (x - 0.12) / 0.25) : 0);
        const wr = N.fbm(x * 6 + 0.3, z * 6 + y * 4 + 0.7, 3) * 0.018;
        p.setXYZ(i, x * 1.08 + wr, y + 0.15 + wr * 0.5, z * 1.02 + wr);
      }
      bbGeo.computeVertexNormals();
    }
    const beanbag = mesh(bbGeo, M.beanbag, -1.72, 0, cz, null);
    group.add(beanbag);
    props.beanbag = beanbag;
    addCollider([-2.25, 0, cz - 0.5], [-1.2, 0.45, cz + 0.5], { rest: 0.15, soft: true, rolloff: [1, 0, 0.2] });
    anchors.gaming = { approach: new THREE.Vector3(-1.05, 0, cz + 0.05), seat: new THREE.Vector3(-1.76, 0.4, cz), facing: -Math.PI / 2 };

    // rug
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.1), new THREE.MeshStandardMaterial({ map: TX.rug(), normalMap: TX.rugNormal(), normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1 }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(-1.25, 0.004, 1.1); rug.receiveShadow = true;
    group.add(rug);

    // snake plant in the front corner
    const plant = new THREE.Group();
    const potGeo = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.15, 0), new THREE.Vector2(0.17, 0.02), new THREE.Vector2(0.19, 0.38), new THREE.Vector2(0.18, 0.38), new THREE.Vector2(0.16, 0.05), new THREE.Vector2(0, 0.05)], 40);
    mesh(potGeo, M.terracotta, 0, 0, 0, plant);
    mesh(new THREE.CircleGeometry(0.175, 32), M.soil, 0, 0.35, 0, plant).rotation.x = -Math.PI / 2;
    const leafMat = new THREE.MeshStandardMaterial({ map: TX.snakeLeaf(), side: THREE.DoubleSide, roughness: 0.55 });
    for (let i = 0; i < 11; i++) {
      const h2 = 0.55 + Math.random() * 0.5;
      const lg = new THREE.PlaneGeometry(0.06, h2, 1, 10);
      const lp = lg.attributes.position;
      for (let k = 0; k < lp.count; k++) {
        const y = lp.getY(k) + h2 / 2, t = y / h2;
        lp.setX(k, lp.getX(k) * (1 - Math.pow(t, 3)) * (1 + 0.3 * Math.sin(t * 3)));
        lp.setZ(k, Math.pow(t, 2) * 0.12 + Math.abs(lp.getX(k)) * 0.8);
        lp.setY(k, y);
      }
      lg.computeVertexNormals();
      const leaf = mesh(lg, leafMat, Math.cos(i * 2.3) * 0.06, 0.34, Math.sin(i * 2.3) * 0.06, plant);
      leaf.rotation.y = i * 2.3; leaf.rotation.x = -0.08 - Math.random() * 0.15;
    }
    plant.position.set(minX + 0.3, 0, maxZ - 0.45);
    group.add(plant);
    addCollider([minX + 0.1, 0, maxZ - 0.65], [minX + 0.5, 0.9, maxZ - 0.25], { rest: 0.3 });
  }

  // ---------------------------------------------------------------- open-side ball bounds (invisible)
  props.bounds = { minX, maxX, minZ, maxZ, H };
  anchors.dance = { pos: new THREE.Vector3(0.65, 0, 0.95), facing: 0.45 };
  anchors.hoops = { pos: new THREE.Vector3(0.7, 0, 0.35), facing: Math.PI };

  shadowAll(group, true, true);
  // flat decals and screens shouldn't cast
  [props.sokoScreen, props.stockScreen, props.tvScreen, props.windowGlass].forEach((m) => { if (m) m.castShadow = false; });

  return { group, colliders, hotspots, props, anchors };
}

// ---------------------------------------------------------------------------
// Cyberdeck: hard case, hinged lid with a 7" screen, 40% ortholinear board,
// trackball, encoder knob, SMA antenna, latches.
function buildCyberdeck(M) {
  const g = new THREE.Group();
  const W = 0.36, D = 0.25, Hb = 0.055;
  mesh(rbox(W, Hb, D, 0.012, 3), M.deckShell, 0, Hb / 2, 0, g);
  // inset deck plate
  mesh(rbox(W - 0.03, 0.006, D - 0.06, 0.004), M.plasticMatte, 0, Hb + 0.001, 0.012, g);
  // keyboard: 12 x 4 keys
  const keyGeo = rbox(0.0175, 0.009, 0.0175, 0.003, 2);
  const cols = 12, rows = 4, pitch = 0.0205;
  const keys = new THREE.InstancedMesh(keyGeo, M.capDark, cols * rows);
  const keysLight = new THREE.InstancedMesh(keyGeo, M.capLight, cols * rows);
  const keysAccent = new THREE.InstancedMesh(keyGeo, M.capAccent, 4);
  const dummy = new THREE.Object3D();
  let nd = 0, nl = 0, na = 0;
  const keyIndex = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = (c - (cols - 1) / 2) * pitch - 0.035, z = (r - (rows - 1) / 2) * pitch + 0.03;
    dummy.position.set(x, Hb + 0.0085, z); dummy.updateMatrix();
    const mod = c === 0 || c === cols - 1 || r === rows - 1;
    const accent = (r === 0 && c === 0) || (r === 3 && (c === 5 || c === 6)) || (r === 2 && c === 11);
    if (accent) { keysAccent.setMatrixAt(na, dummy.matrix); keyIndex.push(['a', na++, x, z]); }
    else if (mod) { keysLight.setMatrixAt(nl, dummy.matrix); keyIndex.push(['l', nl++, x, z]); }
    else { keys.setMatrixAt(nd, dummy.matrix); keyIndex.push(['d', nd++, x, z]); }
  }
  keys.count = nd; keysLight.count = nl; keysAccent.count = na;
  for (const k of [keys, keysLight, keysAccent]) { k.castShadow = true; k.receiveShadow = true; k.instanceMatrix.setUsage(THREE.DynamicDrawUsage); g.add(k); }
  // trackball
  mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.006, 24), M.plasticBlack, 0.135, Hb + 0.004, 0.03, g);
  mesh(new THREE.SphereGeometry(0.0145, 24, 16), new THREE.MeshPhysicalMaterial({ color: '#a3271d', roughness: 0.25, clearcoat: 1 }), 0.135, Hb + 0.012, 0.03, g);
  // encoder knob (knurled)
  const knob = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 20), M.alu, 0.135, Hb + 0.008, -0.03, g);
  // latches on the front
  for (const s of [-1, 1]) mesh(rbox(0.04, 0.02, 0.008, 0.003), M.blackMetal, s * 0.11, Hb * 0.6, D / 2 + 0.003, g);
  // label plate
  const [lc, lx] = canvas(256, 48);
  lx.fillStyle = '#b9bcc0'; lx.fillRect(0, 0, 256, 48); lx.fillStyle = '#1a1b1e'; lx.font = '600 26px "IBM Plex Mono", monospace'; lx.fillText('KD-01  //  KERRY', 12, 33);
  const plate = mesh(new THREE.PlaneGeometry(0.07, 0.013), new THREE.MeshStandardMaterial({ map: canvasTexture(lc), metalness: 0.8, roughness: 0.35 }), 0, Hb * 0.45, D / 2 + 0.0005, g);
  plate.castShadow = false;

  // lid
  const lid = new THREE.Group();
  const LH = 0.2;
  mesh(rbox(W, LH, 0.022, 0.012, 3), M.deckShell, 0, LH / 2, -0.011, lid);
  mesh(rbox(0.19, 0.12, 0.004, 0.004), M.plasticBlack, -0.03, LH / 2 + 0.01, 0.001, lid);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.172, 0.103), new THREE.MeshBasicMaterial({ toneMapped: false }));
  screen.position.set(-0.03, LH / 2 + 0.01, 0.0035); lid.add(screen);
  // screws
  for (const [sx, sy] of [[-0.16, 0.02], [0.16, 0.02], [-0.16, LH - 0.02], [0.16, LH - 0.02]]) mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.003, 12), M.chrome, sx, sy, 0.0015, lid).rotation.x = Math.PI / 2;
  // status LEDs + speaker grille on lid
  const ledA = mesh(new THREE.SphereGeometry(0.0025, 8, 6), M.ledGreen, 0.12, LH - 0.04, 0.002, lid);
  const ledB = mesh(new THREE.SphereGeometry(0.0025, 8, 6), M.ledWarm, 0.135, LH - 0.04, 0.002, lid);
  ledB.userData.dynamic = true;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.002, 6), M.plasticBlack, 0.115 + i * 0.008, 0.05 + j * 0.008, 0.0005, lid).rotation.x = Math.PI / 2;
  // antenna
  const ant = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.012, 12), M.chrome, 0, 0, 0, ant);
  mesh(new THREE.CylinderGeometry(0.0035, 0.002, 0.16, 10), M.plasticBlack, 0, 0.085, 0, ant);
  ant.position.set(W / 2 + 0.006, LH - 0.03, -0.01); ant.rotation.z = -0.25;
  lid.add(ant);
  lid.position.set(0, Hb, -D / 2 + 0.01);
  lid.rotation.x = -0.22; // opened a little past vertical
  g.add(lid);
  // ribbon cable visible at the hinge
  mesh(new THREE.BoxGeometry(0.06, 0.002, 0.03), new THREE.MeshStandardMaterial({ color: '#8a8f99', roughness: 0.6 }), 0.1, Hb + 0.004, -D / 2 + 0.02, g).rotation.x = -0.6;

  const pressed = new Map();
  function pressRandom() {
    const k = keyIndex[Math.floor(Math.random() * keyIndex.length)];
    pressed.set(k, 0.09);
  }
  function update(dt) {
    for (const [k, t] of pressed) {
      const [type, idx, x, z] = k;
      const im = type === 'd' ? keys : type === 'l' ? keysLight : keysAccent;
      const nt = t - dt;
      dummy.position.set(x, Hb + 0.0085 - (nt > 0 ? 0.003 : 0), z); dummy.updateMatrix();
      im.setMatrixAt(idx, dummy.matrix); im.instanceMatrix.needsUpdate = true;
      if (nt <= 0) pressed.delete(k); else pressed.set(k, nt);
    }
    ledB.visible = Math.random() > 0.08;
  }
  return { group: g, lid, screen, keys, pressRandom, update, keyboardCenter: new THREE.Vector3(-0.035, Hb + 0.01, 0.03) };
}

function buildChair(M) {
  const g = new THREE.Group();
  // five-star base
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = mesh(new THREE.BoxGeometry(0.03, 0.025, 0.3), M.blackMetal, Math.sin(a) * 0.15, 0.07, Math.cos(a) * 0.15, g);
    leg.rotation.y = a;
    mesh(new THREE.SphereGeometry(0.025, 12, 8), M.rubber, Math.sin(a) * 0.29, 0.025, Math.cos(a) * 0.29, g);
  }
  mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.3, 16), M.chrome, 0, 0.23, 0, g);
  const top = new THREE.Group();
  mesh(rbox(0.56, 0.08, 0.5, 0.04, 3), M.fabricDark, 0, 0.42, 0, top);
  mesh(rbox(0.52, 0.64, 0.07, 0.05, 3), M.fabricDark, 0, 0.8, -0.26, top).rotation.x = -0.12;
  mesh(new THREE.BoxGeometry(0.06, 0.25, 0.04), M.blackMetal, 0, 0.5, -0.24, top);
  for (const s of [-1, 1]) {
    mesh(new THREE.BoxGeometry(0.03, 0.2, 0.03), M.blackMetal, s * 0.32, 0.55, -0.04, top);
    mesh(rbox(0.06, 0.03, 0.24, 0.012), M.plasticMatte, s * 0.32, 0.66, -0.02, top);
  }
  g.add(top);
  g.userData.top = top;
  return g;
}

function buildController(M) {
  const g = new THREE.Group();
  const body = new THREE.Shape();
  body.moveTo(-0.07, 0.02);
  body.bezierCurveTo(-0.08, 0.045, -0.04, 0.05, 0, 0.042);
  body.bezierCurveTo(0.04, 0.05, 0.08, 0.045, 0.07, 0.02);
  body.bezierCurveTo(0.085, -0.02, 0.08, -0.06, 0.06, -0.06);
  body.bezierCurveTo(0.04, -0.06, 0.03, -0.02, 0, -0.02);
  body.bezierCurveTo(-0.03, -0.02, -0.04, -0.06, -0.06, -0.06);
  body.bezierCurveTo(-0.08, -0.06, -0.085, -0.02, -0.07, 0.02);
  const geo = new THREE.ExtrudeGeometry(body, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 4, curveSegments: 24 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -0.011, 0);
  mesh(geo, M.plasticWhite, 0, 0, 0, g);
  mesh(rbox(0.07, 0.006, 0.032, 0.006), M.plasticBlack, 0, 0.022, -0.012, g);
  for (const s of [-1, 1]) {
    mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 16), M.plasticBlack, s * 0.022, 0.02, 0.02, g);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.006, 10), s > 0 ? M.plasticBlack : M.plasticMatte, s * 0.05 + Math.cos(a) * 0.012, 0.022, -0.012 + Math.sin(a) * 0.012, g);
    }
  }
  shadowAll(g);
  return g;
}

function buildRack(M) {
  const g = new THREE.Group();
  const W = 0.54, D = 0.48, Hh = 1.12;
  // posts + rails
  for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) {
    mesh(new THREE.BoxGeometry(0.025, Hh, 0.025), M.blackMetal, x, 0.08 + Hh / 2, z, g);
    mesh(new THREE.SphereGeometry(0.025, 10, 8), M.rubber, x, 0.03, z, g);
  }
  for (const y of [0.09, 0.08 + Hh]) for (const z of [-D / 2, D / 2]) mesh(new THREE.BoxGeometry(W, 0.025, 0.025), M.blackMetal, 0, y, z, g);
  for (const y of [0.09, 0.08 + Hh]) for (const x of [-W / 2, W / 2]) mesh(new THREE.BoxGeometry(0.025, 0.025, D), M.blackMetal, x, y, 0, g);
  const U = 0.0445;
  const devW = W - 0.04, devD = D - 0.04;
  const front = D / 2 - 0.01;
  let y = 0.08 + Hh - 0.02;
  const leds = [];
  const ledGeo = new THREE.BoxGeometry(0.004, 0.003, 0.002);
  function device(units, col, name) {
    const h = units * U - 0.003;
    y -= units * U;
    const d = mesh(rbox(devW, h, devD, 0.004), new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.45, metalness: 0.5, clearcoat: 0.2 }), 0, y + h / 2, -0.01, g);
    d.name = name;
    return { y: y + h / 2, h };
  }
  // router on top
  mesh(rbox(0.26, 0.04, 0.18, 0.01), M.plasticWhite, 0.05, 0.08 + Hh + 0.035, 0, g);
  for (let i = 0; i < 3; i++) { const a = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 8), M.plasticBlack, -0.04 + i * 0.09, 0.08 + Hh + 0.13, -0.08, g); a.rotation.x = -0.2 + i * 0.2; }
  // patch panel
  const pp = device(1, '#16171a', 'patch');
  for (let i = 0; i < 16; i++) mesh(new THREE.BoxGeometry(0.014, 0.012, 0.003), M.plasticBlack, -0.2 + i * 0.026, pp.y, front + 0.0, g).castShadow = false;
  // switch with port LEDs
  const sw = device(1, '#1e2024', 'switch');
  for (let i = 0; i < 16; i++) leds.push({ x: -0.2 + i * 0.026, y: sw.y + 0.012, rate: 0.5 + Math.random() * 6 });
  // patch cables (short loops)
  const cableCols = ['#2a6fb0', '#2a6fb0', '#e0b422', '#2a6fb0', '#c43a3a', '#2a6fb0', '#4f9d4f', '#2a6fb0'];
  cableCols.forEach((col, i) => {
    const x = -0.2 + i * 0.052;
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, pp.y, front + 0.005), new THREE.Vector3(x + 0.004, (pp.y + sw.y) / 2, front + 0.035), new THREE.Vector3(x + 0.008, sw.y, front + 0.005)]);
    mesh(new THREE.TubeGeometry(curve, 12, 0.0025, 6), new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }), 0, 0, 0, g).castShadow = false;
  });
  y -= U * 0.5;
  // brain67: 2U server with OLED + drive bays
  const sv = device(2, '#232528', 'server');
  const oled = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.04), new THREE.MeshBasicMaterial({ toneMapped: false }));
  oled.position.set(-0.15, sv.y, front + 0.0006); g.add(oled);
  for (let i = 0; i < 6; i++) {
    mesh(rbox(0.045, 0.03, 0.004, 0.002), M.plasticBlack, 0.0 + i * 0.05, sv.y, front, g);
    leds.push({ x: 0.0 + i * 0.05 + 0.016, y: sv.y + 0.01, rate: 1 + Math.random() * 3, col: 'blue' });
  }
  y -= U * 0.5;
  // NAS
  const nas = device(2, '#2b2d30', 'nas');
  for (let i = 0; i < 4; i++) {
    mesh(rbox(0.09, 0.07, 0.004, 0.003), M.plasticMatte, -0.17 + i * 0.105, nas.y, front, g);
    leds.push({ x: -0.13 + i * 0.105, y: nas.y - 0.028, rate: 0.6 + Math.random() * 2 });
  }
  y -= U * 2.5;
  // UPS with LCD
  const ups = device(2, '#151618', 'ups');
  const [uc, ux] = canvas(128, 48); ux.fillStyle = '#0d2a35'; ux.fillRect(0, 0, 128, 48); ux.fillStyle = '#7fe0ff'; ux.font = '600 18px monospace'; ux.fillText('230V  42%', 8, 30);
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.022), new THREE.MeshBasicMaterial({ map: canvasTexture(uc), toneMapped: false }));
  lcd.position.set(0.12, ups.y, front + 0.0006); g.add(lcd);
  leds.push({ x: 0.2, y: ups.y, rate: 0, col: 'green' });

  const ledMesh = new THREE.InstancedMesh(ledGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), leds.length);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  leds.forEach((l, i) => { dummy.position.set(l.x, l.y, front + 0.002); dummy.updateMatrix(); ledMesh.setMatrixAt(i, dummy.matrix); ledMesh.setColorAt(i, col.setRGB(0, 0, 0)); });
  g.add(ledMesh);
  let t = 0;
  function update(dt, activity = 0.3) {
    t += dt;
    leds.forEach((l, i) => {
      let on;
      if (l.rate === 0) on = 1;
      else on = Math.sin(t * l.rate * (1 + activity * 3) + i * 7.1) > 0.2 - activity * 0.5 ? 1 : 0.06;
      if (l.col === 'blue') col.setRGB(0.25 * on * 3, 0.5 * on * 3, 1.0 * on * 3);
      else col.setRGB(0.3 * on * 3, 1.0 * on * 3, 0.45 * on * 3);
      ledMesh.setColorAt(i, col);
    });
    ledMesh.instanceColor.needsUpdate = true;
  }
  return { group: g, oled, update };
}

// Acoustic guitar. Origin at the centre of the body's back surface; the neck
// runs along +Y. Exposes string meshes so they can vibrate when plucked.
function buildGuitar(M) {
  const g = new THREE.Group();
  // dreadnought outline: smooth spline through measured half-widths, mirrored
  const half = [[0, -0.25], [0.11, -0.238], [0.172, -0.2], [0.197, -0.13], [0.19, -0.06], [0.158, -0.0], [0.137, 0.04], [0.146, 0.1], [0.151, 0.15], [0.128, 0.208], [0.07, 0.243], [0, 0.25]];
  const spline = new THREE.SplineCurve(half.map(([x, y]) => new THREE.Vector2(x, y)));
  const hp = spline.getPoints(80);
  const outline = new THREE.Shape();
  outline.moveTo(hp[0].x, hp[0].y);
  hp.forEach((p) => outline.lineTo(p.x, p.y));
  for (let i = hp.length - 2; i > 0; i--) outline.lineTo(-hp[i].x, hp[i].y);
  outline.closePath();
  const depth = 0.1;
  const bodyGeo = new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 3, curveSegments: 12 });
  // planar UVs for the top
  const uv = bodyGeo.attributes.uv, pos = bodyGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 0.4 + 0.5, pos.getY(i) / 0.5 + 0.5);
  const topMat = new THREE.MeshPhysicalMaterial({ map: TX.spruce(), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
  const sideMat = new THREE.MeshPhysicalMaterial({ map: TX.rosewood(), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
  const body = mesh(bodyGeo, [topMat, sideMat], 0, 0, 0, g);
  // binding
  const front = depth + 0.006;
  // sound hole + rosette
  mesh(new THREE.CircleGeometry(0.045, 40), new THREE.MeshBasicMaterial({ color: '#0b0705' }), 0, 0.05, front + 0.0005, g);
  mesh(new THREE.RingGeometry(0.05, 0.06, 48), new THREE.MeshStandardMaterial({ color: '#3a2618', roughness: 0.4 }), 0, 0.05, front + 0.0006, g);
  // pickguard
  const pg = new THREE.Shape();
  pg.moveTo(0.05, 0.0); pg.quadraticCurveTo(0.12, 0.0, 0.12, 0.07); pg.quadraticCurveTo(0.1, 0.12, 0.06, 0.1); pg.quadraticCurveTo(0.05, 0.05, 0.05, 0.0);
  mesh(new THREE.ShapeGeometry(pg), new THREE.MeshPhysicalMaterial({ color: '#2a1610', roughness: 0.2, clearcoat: 1 }), 0, 0.0, front + 0.0007, g);
  // bridge + saddle
  mesh(rbox(0.13, 0.025, 0.008, 0.004), new THREE.MeshStandardMaterial({ color: '#1f120b', roughness: 0.35 }), 0, -0.12, front + 0.004, g);
  mesh(new THREE.BoxGeometry(0.06, 0.003, 0.004), M.ceramic, 0, -0.115, front + 0.009, g);
  // neck + fretboard
  const neckLen = 0.42;
  const neck = mesh(new THREE.BoxGeometry(0.048, neckLen, 0.024), sideMat, 0, 0.25 + neckLen / 2 - 0.02, front - 0.014, g);
  const fb = mesh(new THREE.BoxGeometry(0.05, neckLen + 0.06, 0.006), new THREE.MeshStandardMaterial({ map: TX.rosewood(), color: '#5a3828', roughness: 0.5 }), 0, 0.25 + neckLen / 2 - 0.05, front + 0.002, g);
  const scale = 0.645;
  const nutY = 0.25 + neckLen - 0.02 + 0.02;
  const bridgeY = -0.115;
  const fretGeo = new THREE.BoxGeometry(0.05, 0.0015, 0.0025);
  for (let i = 1; i <= 18; i++) {
    const d = scale - scale / Math.pow(2, i / 12);
    const fy = nutY - d * ((nutY - bridgeY) / scale);
    if (fy < 0.21) break;
    mesh(fretGeo, M.chrome, 0, fy, front + 0.006, g).castShadow = false;
    if ([3, 5, 7, 9, 12, 15].includes(i)) mesh(new THREE.CircleGeometry(0.0035, 12), M.ceramic, 0, fy + 0.012, front + 0.0052, g);
  }
  mesh(new THREE.BoxGeometry(0.05, 0.004, 0.006), M.ceramic, 0, nutY, front + 0.006, g);
  // headstock + tuners
  const head = mesh(rbox(0.075, 0.17, 0.016, 0.006), sideMat, 0, nutY + 0.09, front - 0.01, g);
  head.rotation.x = 0.22;
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
    const ty = nutY + 0.04 + i * 0.045;
    mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.02, 8), M.chrome, s * 0.045, ty, front - 0.018 - (ty - nutY) * 0.22, g).rotation.z = Math.PI / 2;
    mesh(rbox(0.014, 0.012, 0.004, 0.002), M.ceramic, s * 0.06, ty, front - 0.018 - (ty - nutY) * 0.22, g);
  }
  // strings
  const strings = [];
  const gauges = [0.0007, 0.0006, 0.0005, 0.00042, 0.00032, 0.00026];
  const strLen = nutY - bridgeY;
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 0.0085;
    const geo = new THREE.CylinderGeometry(gauges[i], gauges[i], strLen, 5, 12);
    const s = new THREE.Mesh(geo, i < 3 ? new THREE.MeshStandardMaterial({ color: '#b98f4e', metalness: 1, roughness: 0.3 }) : M.chrome);
    s.position.set(x * (1 + 0.0), (nutY + bridgeY) / 2, front + 0.009);
    s.userData = { amp: 0, phase: 0, base: geo.attributes.position.array.slice(), freq: 110 * Math.pow(1.335, i) };
    g.add(s); strings.push(s);
  }
  function pluck(stringIndex, strength = 1) {
    const s = strings[stringIndex]; if (!s) return;
    s.userData.amp = 0.0018 * strength;
  }
  function update(dt) {
    for (const s of strings) {
      const u = s.userData;
      if (u.amp < 1e-5) { if (u.dirty) { s.geometry.attributes.position.array.set(u.base); s.geometry.attributes.position.needsUpdate = true; u.dirty = false; } continue; }
      u.phase += dt * 60;
      const arr = s.geometry.attributes.position.array;
      for (let k = 0; k < arr.length; k += 3) {
        const yy = u.base[k + 1] / strLen + 0.5;
        const disp = Math.sin(yy * Math.PI) * u.amp * Math.sin(u.phase * (1 + (k % 7) * 0.01));
        arr[k] = u.base[k] + disp;
        arr[k + 2] = u.base[k + 2] + disp * 0.4;
      }
      s.geometry.attributes.position.needsUpdate = true;
      u.amp *= Math.exp(-dt * 3.5);
      u.dirty = true;
    }
  }
  // local points used by the hand IK
  const fretPos = (fret) => {
    const d = scale - scale / Math.pow(2, Math.max(0.5, fret - 0.5) / 12);
    return new THREE.Vector3(0, nutY - d * ((nutY - bridgeY) / scale), front + 0.02);
  };
  return { group: g, body, strings, pluck, update, fretPos, strumPos: new THREE.Vector3(0.02, 0.03, front + 0.03), front };
}
