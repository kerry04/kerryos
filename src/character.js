import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ASSETS } from './config.js';
import { clamp, lerp } from './util.js';
import * as TX from './textures.js';

// The character layer has two parts:
//  1. Clips (idle/walk/jog/dance/talk/jump) played through an AnimationMixer,
//     retargeted by normalised bone name and stripped of root motion.
//  2. A procedural layer applied after the mixer: seat/hip placement, two-bone
//     IK for arms and legs, spine lean and head look. It works in world space
//     by aiming bones at targets, so it does not care how the rig's local axes
//     are oriented — it behaves the same on Mixamo, Avaturn or RPM skeletons.

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

const norm = (n) => n.toLowerCase()
  .replace(/^mixamorig\d*[:_]?/, '').replace(/^armature[|_]/, '').replace(/^def[-_]/, '')
  .replace(/[^a-z0-9]/g, '')
  .replace('upperarm', 'arm').replace('lowerarm', 'forearm').replace('thigh', 'upleg').replace('calf', 'leg').replace('shin', 'leg');

const WANT = ['hips', 'spine', 'spine1', 'spine2', 'neck', 'head',
  'leftshoulder', 'leftarm', 'leftforearm', 'lefthand', 'lefthandmiddle1',
  'rightshoulder', 'rightarm', 'rightforearm', 'righthand', 'righthandmiddle1',
  'leftupleg', 'leftleg', 'leftfoot', 'lefttoebase', 'rightupleg', 'rightleg', 'rightfoot', 'righttoebase'];

export async function loadCharacter(manager, onProgressNote) {
  const loader = new GLTFLoader(manager);
  const draco = new DRACOLoader(manager);
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/libs/draco/gltf/');
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);

  const gltf = await loader.loadAsync(ASSETS.character);
  const model = gltf.scene;
  const bones = {};
  model.traverse((o) => {
    if (o.isBone || o.type === 'Bone') {
      const k = norm(o.name);
      if (WANT.includes(k) && !bones[k]) bones[k] = o;
    }
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      o.frustumCulled = false;
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { if (m.map) m.map.anisotropy = 8; m.envMapIntensity = 0.8; });
      }
    }
  });

  // normalise height to ~1.78 m if the file is in odd units
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const h = box.max.y - box.min.y;
  if (h > 0 && (h < 1.2 || h > 2.4)) model.scale.multiplyScalar(1.78 / h);
  model.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(model);
  model.position.y -= box2.min.y;

  applyOutfit(model);

  // rest pose of the character, by normalised bone name
  const restQ = {}, restP = {};
  model.traverse((o) => { if (o.isBone) { const k = norm(o.name); if (!restQ[k]) { restQ[k] = o.quaternion.clone(); restP[k] = o.position.clone(); } } });

  // clips
  const clips = {};
  const cache = {};
  for (const [name, [url, clipName]] of Object.entries(ASSETS.clips)) {
    try {
      const g = url === ASSETS.character ? gltf : (cache[url] ||= await loader.loadAsync(url));
      let clip = clipName ? g.animations.find((a) => a.name === clipName) : null;
      if (!clip) clip = g.animations.slice().sort((a, b) => b.duration - a.duration)[0];
      // rest pose of the clip's own skeleton (identity when it matches Kerry's rig)
      const srcQ = {};
      if (g !== gltf) g.scene.traverse((o) => { if (o.isBone) { const k = norm(o.name); if (!srcQ[k]) srcQ[k] = o.quaternion.clone(); } });
      if (clip) clips[name] = retarget(clip.clone(), bones, name, { restQ, restP, srcQ });
    } catch (e) {
      console.warn('[character] clip failed', name, e);
    }
  }
  return new Character(model, bones, clips);
}

function retarget(clip, bones, name, { restQ, restP, srcQ }) {
  const tracks = [];
  const q = new THREE.Quaternion(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf('.');
    const node = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
    if (prop === 'scale') continue;
    const k = norm(node.split('/').pop());
    const bone = bones[k] || null;
    if (!bone) continue;
    if (prop === 'quaternion' && srcQ[k] && restQ[k]) {
      // q' = restTarget * restSource^-1 * q  (skip when the rest poses already match)
      const sr = srcQ[k], tr = restQ[k];
      if (Math.abs(sr.dot(tr)) < 0.9995) {
        const inv = sr.clone().invert();
        const v = t.values;
        for (let i = 0; i < v.length; i += 4) {
          q.fromArray(v, i);
          qa.copy(inv).multiply(q);
          qb.copy(tr).multiply(qa);
          qb.toArray(v, i);
        }
      }
    }
    if (prop === 'position') {
      if (k !== 'hips') continue; // only the hips translate
      const v = t.values, rp = restP[k] || bone.position;
      const y0 = v[1];
      // keep the clip's bounce (vertical change from its first frame), scaled to Kerry,
      // and drop horizontal root motion entirely
      const scale = Math.abs(y0) > 1e-4 && Math.abs(rp.y / y0) > 0.2 && Math.abs(rp.y / y0) < 5 ? rp.y / y0 : 1;
      for (let i = 0; i < v.length; i += 3) {
        const dy = clamp((v[i + 1] - y0) * scale, -0.6 * Math.abs(rp.y), 0.35 * Math.abs(rp.y));
        v[i] = rp.x; v[i + 1] = rp.y + dy; v[i + 2] = rp.z;
      }
    }
    t.name = `${bone.name}.${prop}`;
    tracks.push(t);
  }
  clip.tracks = tracks;
  clip.name = name;
  return clip;
}

// Kerry wears a sky-blue football shirt and black basketball shorts when the
// model has separable top/bottom meshes or materials.
function applyOutfit(model) {
  const shirt = new THREE.MeshPhysicalMaterial({ color: '#79afdc', roughness: 0.78, sheen: 0.8, sheenRoughness: 0.4, sheenColor: new THREE.Color('#d9ecfb'), normalMap: TX.fabricNormal(18), normalScale: new THREE.Vector2(0.35, 0.35) });
  const shorts = new THREE.MeshPhysicalMaterial({ color: '#16171a', roughness: 0.6, sheen: 0.6, sheenColor: new THREE.Color('#5a5f68'), normalMap: TX.fabricNormal(18), normalScale: new THREE.Vector2(0.3, 0.3) });
  const found = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const label = (o.name + ' ' + mats.map((m) => m?.name || '').join(' ')).toLowerCase();
    if (/(outfit_top|top|shirt|tshirt|t-shirt|hoodie|upper|torso|jersey|jacket)/.test(label) && !/(head|hair|eye|teeth|body_skin)/.test(label)) {
      o.material = shirt; found.push('top:' + o.name);
    } else if (/(outfit_bottom|bottom|pants|short|trouser|jeans)/.test(label)) {
      o.material = shorts; found.push('bottom:' + o.name);
    }
  });
  if (found.length) console.info('[character] outfit applied to', found.join(', '));
  else console.info('[character] no separable clothing meshes; keeping the model\'s own outfit');
}

class Character {
  constructor(model, bones, clips) {
    this.root = new THREE.Group();
    this.root.name = 'Kerry';
    this.model = model;
    this.root.add(model);
    this.bones = bones;
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const [k, c] of Object.entries(clips)) {
      const a = this.mixer.clipAction(c);
      a.enabled = true;
      this.actions[k] = a;
    }
    this.current = null;
    this.ok = !!(bones.hips && bones.leftarm && bones.rightarm && bones.leftupleg && bones.head);

    // bind-pose lengths and forward axes
    model.updateMatrixWorld(true);
    const len = (a, b) => (this.bones[a] && this.bones[b] ? this.bones[a].getWorldPosition(_v1).distanceTo(this.bones[b].getWorldPosition(_v2)) : 0.3);
    this.len = {
      lUpper: len('leftarm', 'leftforearm'), lLower: len('leftforearm', 'lefthand'),
      rUpper: len('rightarm', 'rightforearm'), rLower: len('rightforearm', 'righthand'),
      lThigh: len('leftupleg', 'leftleg'), lShin: len('leftleg', 'leftfoot'),
      rThigh: len('rightupleg', 'rightleg'), rShin: len('rightleg', 'rightfoot'),
    };
    this.hipsRestWorldY = bones.hips ? bones.hips.getWorldPosition(_v1).y : 1;
    // the character faces +Z in model space
    this.headFwd = this.localAxis(bones.head, new THREE.Vector3(0, 0, 1));
    this.spineFwd = this.localAxis(bones.spine1 || bones.spine, new THREE.Vector3(0, 0, 1));
    this.chestFwd = this.localAxis(bones.spine2 || bones.spine1, new THREE.Vector3(0, 0, 1));

    // procedural layer state
    this.p = {
      seat: null, seatW: 0,            // world position for hips
      lie: 0,
      feet: { l: null, r: null, w: 0 }, // world foot targets
      hands: { l: null, r: null, wl: 0, wr: 0, poleL: null, poleR: null, handDirL: null, handDirR: null },
      look: null, lookW: 0,
      lean: 0,                          // forward lean in radians (spine)
      crouch: 0,                        // hips drop in metres with planted feet
      breathe: 0,
    };
    this.time = 0;
    this.capsule = { a: new THREE.Vector3(), b: new THREE.Vector3() };
    this.play('idle', 0);
  }

  localAxis(bone, worldDir) {
    if (!bone) return new THREE.Vector3(0, 0, 1);
    const q = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
    return worldDir.clone().applyQuaternion(q).normalize();
  }

  play(name, fade = 0.35, timeScale = 1) {
    const a = this.actions[name] || this.actions.idle;
    if (!a) return;
    if (this.current === a) { a.timeScale = timeScale; return; }
    a.reset(); a.setEffectiveWeight(1); a.timeScale = timeScale; a.play();
    if (this.current) this.current.crossFadeTo(a, fade, false);
    else a.fadeIn(fade);
    this.current = a; this.currentName = name;
  }

  has(name) { return !!this.actions[name]; }

  // world-space helpers ------------------------------------------------------
  toWorld(local, out = new THREE.Vector3()) { return out.copy(local).applyMatrix4(this.root.matrixWorld); }
  wp(name, out = new THREE.Vector3()) { return this.bones[name] ? this.bones[name].getWorldPosition(out) : out.set(0, 0, 0); }

  aim(bone, child, dirWorld, weight = 1) {
    if (!bone || !child || weight <= 0) return;
    const a = bone.getWorldPosition(_v1), b = child.getWorldPosition(_v2);
    const cur = _v3.subVectors(b, a).normalize();
    const want = _v4.copy(dirWorld).normalize();
    const dq = _q1.setFromUnitVectors(cur, want);
    const wq = bone.getWorldQuaternion(_q2);
    const pq = bone.parent.getWorldQuaternion(_q3).invert();
    const target = dq.multiply(wq); // world
    const local = pq.multiply(target);
    bone.quaternion.slerp(local, weight);
    bone.updateMatrixWorld(true);
  }

  // rotate bone so that its local `axis` points along `dirWorld`
  aimAxis(bone, axisLocal, dirWorld, weight = 1, maxAngle = Math.PI) {
    if (!bone || weight <= 0) return;
    const wq = bone.getWorldQuaternion(_q2);
    const cur = _v3.copy(axisLocal).applyQuaternion(wq).normalize();
    const want = _v4.copy(dirWorld).normalize();
    let ang = cur.angleTo(want);
    const dq = _q1.setFromUnitVectors(cur, want);
    if (ang > maxAngle) { dq.slerp(new THREE.Quaternion(), 1 - maxAngle / ang); }
    const target = dq.multiply(wq);
    const local = bone.parent.getWorldQuaternion(_q3).invert().multiply(target);
    bone.quaternion.slerp(local, weight);
    bone.updateMatrixWorld(true);
  }

  twoBone(upper, mid, end, lenA, lenB, target, pole, weight = 1) {
    if (!upper || !mid || !end || weight <= 0 || !target) return;
    const S = upper.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3().subVectors(target, S);
    const d = clamp(dir.length(), Math.abs(lenA - lenB) + 1e-3, lenA + lenB - 1e-3);
    dir.normalize();
    const pv = new THREE.Vector3().subVectors(pole, S);
    pv.addScaledVector(dir, -pv.dot(dir));
    if (pv.lengthSq() < 1e-8) pv.set(0, -1, 0).addScaledVector(dir, -dir.y);
    pv.normalize();
    const cosA = clamp((lenA * lenA + d * d - lenB * lenB) / (2 * lenA * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const E = S.clone().addScaledVector(dir, lenA * cosA).addScaledVector(pv, lenA * sinA);
    const T = S.clone().addScaledVector(dir, d);
    const q0u = upper.quaternion.clone(), q0m = mid.quaternion.clone();
    this.aim(upper, mid, E.clone().sub(S), 1);
    this.aim(mid, end, T.clone().sub(E), 1);
    if (weight < 1) {
      const qu = upper.quaternion.clone(), qm = mid.quaternion.clone();
      upper.quaternion.copy(q0u).slerp(qu, weight); upper.updateMatrixWorld(true);
      mid.quaternion.copy(q0m).slerp(qm, weight); mid.updateMatrixWorld(true);
    }
  }

  // --------------------------------------------------------------------------
  update(dt) {
    this.time += dt;
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    if (!this.ok) return this.updateCapsule();
    const B = this.bones, P = this.p;

    // capture where the clip put the feet (for planted-foot crouches)
    const footL = B.leftfoot.getWorldPosition(new THREE.Vector3());
    const footR = B.rightfoot.getWorldPosition(new THREE.Vector3());

    // 1) hips: seat placement or crouch
    if (P.seatW > 0 && P.seat) {
      const cur = B.hips.getWorldPosition(new THREE.Vector3());
      const want = cur.clone().lerp(P.seat, P.seatW);
      const parentInv = B.hips.parent.matrixWorld.clone().invert();
      B.hips.position.copy(want.applyMatrix4(parentInv));
      B.hips.updateMatrixWorld(true);
    } else if (P.crouch > 0) {
      const cur = B.hips.getWorldPosition(new THREE.Vector3());
      cur.y -= P.crouch;
      B.hips.position.copy(cur.applyMatrix4(B.hips.parent.matrixWorld.clone().invert()));
      B.hips.updateMatrixWorld(true);
    }

    // 2) spine lean (bend forward around the character's right axis)
    if (Math.abs(P.lean) > 1e-3) {
      const fwd = new THREE.Vector3(0, 0, 1).transformDirection(this.root.matrixWorld);
      const up = new THREE.Vector3(0, 1, 0).transformDirection(this.root.matrixWorld);
      const dir = up.clone().multiplyScalar(Math.cos(P.lean)).addScaledVector(fwd, Math.sin(P.lean));
      const chain = [B.spine, B.spine1, B.spine2].filter(Boolean);
      for (const b of chain) {
        const child = b.children.find((c) => c.isBone) || null;
        if (child) this.aim(b, child, dir, 0.45);
      }
    }

    // 3) legs
    const legW = P.feet.w;
    if (legW > 0 || P.crouch > 0) {
      const tl = P.feet.l || footL, tr = P.feet.r || footR;
      const fwd = new THREE.Vector3(0, 0, 1).transformDirection(this.root.matrixWorld);
      const kneeL = B.leftleg.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 1);
      const kneeR = B.rightleg.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 1);
      const w = Math.max(legW, P.crouch > 0 ? 1 : 0);
      this.twoBone(B.leftupleg, B.leftleg, B.leftfoot, this.len.lThigh, this.len.lShin, tl, kneeL, w);
      this.twoBone(B.rightupleg, B.rightleg, B.rightfoot, this.len.rThigh, this.len.rShin, tr, kneeR, w);
      // keep soles roughly flat
      if (B.lefttoebase) this.aim(B.leftfoot, B.lefttoebase, fwd.clone().multiplyScalar(1).add(new THREE.Vector3(0, -0.25, 0)), w * 0.8);
      if (B.righttoebase) this.aim(B.rightfoot, B.righttoebase, fwd.clone().multiplyScalar(1).add(new THREE.Vector3(0, -0.25, 0)), w * 0.8);
    }

    // 4) arms
    const H = P.hands;
    if (H.wl > 0 && H.l) {
      const pole = H.poleL || this.toWorld(new THREE.Vector3(0.6, 0.6, -0.6));
      this.twoBone(B.leftarm, B.leftforearm, B.lefthand, this.len.lUpper, this.len.lLower, H.l, pole, H.wl);
      if (H.handDirL && B.lefthandmiddle1) this.aim(B.lefthand, B.lefthandmiddle1, H.handDirL, H.wl * 0.8);
    }
    if (H.wr > 0 && H.r) {
      const pole = H.poleR || this.toWorld(new THREE.Vector3(-0.6, 0.6, -0.6));
      this.twoBone(B.rightarm, B.rightforearm, B.righthand, this.len.rUpper, this.len.rLower, H.r, pole, H.wr);
      if (H.handDirR && B.righthandmiddle1) this.aim(B.righthand, B.righthandmiddle1, H.handDirR, H.wr * 0.8);
    }

    // 5) breathing (chest) — subtle, always on
    if (B.spine2) {
      const s = Math.sin(this.time * (P.lie > 0.5 ? 1.4 : 2.1)) * (P.lie > 0.5 ? 0.025 : 0.012);
      B.spine2.rotateX(s * 0.5);
      B.spine2.updateMatrixWorld(true);
    }

    // 6) head look
    if (P.lookW > 0 && P.look && B.head) {
      const hp = B.head.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3().subVectors(P.look, hp);
      if (B.neck) this.aimAxis(B.neck, this.localAxis(B.neck, new THREE.Vector3(0, 0, 1).transformDirection(this.model.matrixWorld)), dir, P.lookW * 0.35, 0.6);
      this.aimAxis(B.head, this.headFwd, dir, P.lookW * 0.8, 1.1);
    }
    this.updateCapsule();
  }

  updateCapsule() {
    const r = this.root;
    if (this.p.lie > 0.5) {
      this.capsule.a.copy(this.toWorld(new THREE.Vector3(0, 0.3, 0)));
      this.capsule.b.copy(this.toWorld(new THREE.Vector3(0, 1.5, 0)));
    } else {
      const hip = this.bones.hips ? this.bones.hips.getWorldPosition(new THREE.Vector3()) : r.position.clone().setY(1);
      this.capsule.a.set(hip.x, Math.max(0.25, hip.y - 0.55), hip.z);
      this.capsule.b.set(hip.x, hip.y + 0.55, hip.z);
    }
  }

  // convenience setters used by activity scripts --------------------------------
  resetLayer() {
    const P = this.p;
    P.seatW = 0; P.seat = null; P.feet.w = 0; P.feet.l = P.feet.r = null;
    P.hands.wl = P.hands.wr = 0; P.hands.l = P.hands.r = null; P.hands.poleL = P.hands.poleR = null; P.hands.handDirL = P.hands.handDirR = null;
    P.lookW = 0; P.lean = 0; P.crouch = 0;
  }
}
