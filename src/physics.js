import * as THREE from 'three';
import { HOOP } from './room.js';
import * as TX from './textures.js';
import { clamp } from './util.js';

// Basketball physics: hollow-shell sphere with spin, friction coupling at every
// contact, rim torus, backboard, furniture boxes, a soft net that drags and
// deforms, and a kinematic capsule for Kerry so the ball bounces off him.

const G = -9.81;
const R = 0.118;
const I_RATIO = 2 / 3; // thin shell
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();

export function createBall(scene, colliders, bounds, { onImpact, onScore } = {}) {
  const geo = new THREE.SphereGeometry(R, 48, 32);
  const mat = new THREE.MeshPhysicalMaterial({ map: TX.basketball(), normalMap: TX.pebbleNormal(), normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.62, sheen: 0.3, sheenColor: new THREE.Color('#ffb08a') });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.hotspot = 'hoop';
  mesh.userData.isBall = true;
  scene.add(mesh);

  const s = {
    pos: new THREE.Vector3(1.05, R, 0.25), vel: new THREE.Vector3(), ang: new THREE.Vector3(),
    q: new THREE.Quaternion(), held: null, sleeping: true, restTime: 0, onFloor: false,
    lastScoreCheckY: 0, shotId: 0, scoredShot: -1, rimHitShot: -1, inNet: false, lastHitKerry: 0,
  };
  mesh.position.copy(s.pos);

  // ------------------------------------------------------------- net
  const strands = 12, rows = 7, depth = 0.42;
  const netRest = [], netOff = [], netVel = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const rr = HOOP.R * (1 - t) + 0.13 * t;
    for (let i = 0; i < strands; i++) {
      const a = ((i + (j % 2) * 0.5) / strands) * Math.PI * 2;
      netRest.push(new THREE.Vector3(HOOP.rim.x + Math.cos(a) * rr, HOOP.rim.y - 0.008 - t * depth, HOOP.rim.z + Math.sin(a) * rr));
      netOff.push(new THREE.Vector3()); netVel.push(new THREE.Vector3());
    }
  }
  const idx = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < strands; i++) {
    const a = j * strands + i;
    const b1 = (j + 1) * strands + i;
    const b2 = (j + 1) * strands + ((i + (j % 2 ? 1 : -1) + strands) % strands);
    idx.push(a, b1, a, b2);
  }
  const netGeo = new THREE.BufferGeometry();
  netGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(netRest.length * 3), 3));
  netGeo.setIndex(idx);
  const net = new THREE.LineSegments(netGeo, new THREE.LineBasicMaterial({ color: '#f1f1ee' }));
  net.frustumCulled = false;
  scene.add(net);

  function updateNet(dt) {
    const arr = netGeo.attributes.position.array;
    for (let k = 0; k < netRest.length; k++) {
      const row = Math.floor(k / strands);
      const o = netOff[k], v = netVel[k];
      if (row > 0) {
        // spring back + damping
        v.addScaledVector(o, -90 * dt).multiplyScalar(Math.exp(-6 * dt));
        o.addScaledVector(v, dt);
        // keep the strands clear of the ball
        const p = tmp.copy(netRest[k]).add(o);
        const d = tmp2.subVectors(p, s.pos);
        const dist = d.length();
        if (dist < R + 0.006 && dist > 1e-4) {
          d.multiplyScalar((R + 0.006 - dist) / dist);
          o.add(d); v.addScaledVector(d, 20);
          // the net drags the ball a little
          s.vel.multiplyScalar(1 - 0.012);
        }
      }
      const p = tmp.copy(netRest[k]).add(o);
      arr[k * 3] = p.x; arr[k * 3 + 1] = p.y; arr[k * 3 + 2] = p.z;
    }
    netGeo.attributes.position.needsUpdate = true;
  }

  // ------------------------------------------------------------- kinematic capsule (Kerry)
  const body = { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.2, vel: new THREE.Vector3(), active: false };

  function contact(n, pen, rest, fric, extraVel = null) {
    // positional correction
    s.pos.addScaledVector(n, pen);
    const rel = tmp3.copy(s.vel);
    if (extraVel) rel.sub(extraVel);
    const vn = rel.dot(n);
    if (vn >= 0) return 0;
    const impactSpeed = -vn;
    // normal impulse with restitution (velocity-dependent: soft at low speeds)
    const e = impactSpeed < 0.4 ? rest * 0.4 : rest;
    const jn = -(1 + e) * vn;
    s.vel.addScaledVector(n, jn);
    // friction at the contact point: v_c = v + w x (-n R)
    const rC = tmp.copy(n).multiplyScalar(-R);
    const vc = tmp2.copy(s.ang).cross(rC).add(rel).addScaledVector(n, -rel.dot(n));
    // impulse to stop slipping, limited by Coulomb
    const k = 1 / (1 + 1 / I_RATIO); // for shell, 0.4
    let jt = vc.length() * k;
    const maxJt = fric * jn;
    if (jt > maxJt) jt = maxJt;
    if (vc.lengthSq() > 1e-8) {
      const J = vc.normalize().multiplyScalar(-jt);
      s.vel.add(J);
      // dw = (r x J) / I
      const dw = tmp3.copy(rC).cross(J).multiplyScalar(1 / (I_RATIO * R * R));
      s.ang.add(dw);
    }
    return impactSpeed;
  }

  function collideBox(c) {
    const cx = clamp(s.pos.x, c.min.x, c.max.x), cy = clamp(s.pos.y, c.min.y, c.max.y), cz = clamp(s.pos.z, c.min.z, c.max.z);
    const d = tmp.set(s.pos.x - cx, s.pos.y - cy, s.pos.z - cz);
    const dist2 = d.lengthSq();
    if (dist2 > R * R) return 0;
    let n, pen;
    if (dist2 > 1e-10) {
      const dist = Math.sqrt(dist2);
      n = d.multiplyScalar(1 / dist).clone(); pen = R - dist;
    } else {
      // centre inside: push out along the shortest axis
      const opts = [
        [s.pos.x - c.min.x, -1, 0, 0], [c.max.x - s.pos.x, 1, 0, 0],
        [s.pos.y - c.min.y, 0, -1, 0], [c.max.y - s.pos.y, 0, 1, 0],
        [s.pos.z - c.min.z, 0, 0, -1], [c.max.z - s.pos.z, 0, 0, 1],
      ].sort((a, b) => a[0] - b[0]);
      n = new THREE.Vector3(opts[0][1], opts[0][2], opts[0][3]); pen = opts[0][0] + R;
    }
    const sp = contact(n, pen, c.rest, c.fric);
    if (c.soft) s.vel.multiplyScalar(0.92);
    return sp;
  }

  const rimFloor = HOOP.rim.y;
  const board = HOOP.board;
  const boardBox = { min: new THREE.Vector3(board.x0, board.y0, board.z - 0.013), max: new THREE.Vector3(board.x1, board.y1, board.z + 0.013), rest: 0.62, fric: 0.25 };

  function substep(h) {
    s.vel.y += G * h;
    s.vel.multiplyScalar(1 - 0.015 * h);
    s.pos.addScaledVector(s.vel, h);
    s.onFloor = false;

    // floor
    if (s.pos.y < R) {
      const sp = contact(tmp.set(0, 1, 0).clone(), R - s.pos.y, 0.79, 0.65);
      s.onFloor = true;
      if (sp > 0.25) onImpact?.('floor', sp, s.pos);
    }
    // walls and invisible bounds
    const planes = [
      [bounds.minX + R, 1, 0, 0, 'wall'], [bounds.maxX - R, -1, 0, 0, 'edge'],
      [bounds.minZ + R, 0, 0, 1, 'wall'], [bounds.maxZ - R, 0, 0, -1, 'edge'],
    ];
    for (const [lim, nx, ny, nz, kind] of planes) {
      const coord = nx !== 0 ? s.pos.x : s.pos.z;
      const sign = nx + nz;
      const pen = sign > 0 ? lim - coord : coord - lim;
      if (pen > 0) {
        const sp = contact(new THREE.Vector3(nx, ny, nz), pen, kind === 'wall' ? 0.6 : 0.3, 0.4);
        if (sp > 0.3 && kind === 'wall') onImpact?.('wall', sp, s.pos);
      }
    }
    if (s.pos.y > 3.4 - R) { s.pos.y = 3.4 - R; if (s.vel.y > 0) s.vel.y *= -0.3; }

    // furniture
    for (const c of colliders) {
      if (!c.ball) continue;
      const sp = collideBox(c);
      if (sp > 0.4) onImpact?.(c.soft ? 'soft' : 'furniture', sp, s.pos);
    }
    // backboard
    {
      const sp = collideBox(boardBox);
      if (sp > 0.3) onImpact?.('board', sp, s.pos);
    }
    // rim torus
    {
      const dx = s.pos.x - HOOP.rim.x, dz = s.pos.z - HOOP.rim.z;
      const hl = Math.hypot(dx, dz) || 1e-6;
      const qx = HOOP.rim.x + (dx / hl) * HOOP.R, qz = HOOP.rim.z + (dz / hl) * HOOP.R;
      const n = tmp.set(s.pos.x - qx, s.pos.y - HOOP.rim.y, s.pos.z - qz);
      const dist = n.length();
      if (dist < R + HOOP.tube) {
        const sp = contact(n.multiplyScalar(1 / dist).clone(), R + HOOP.tube - dist, 0.58, 0.35);
        if (sp > 0.2) { onImpact?.('rim', sp, s.pos); s.rimHitShot = s.shotId; }
      }
    }
    // net: funnel + drag
    {
      const dy = HOOP.rim.y - s.pos.y;
      if (dy > -0.02 && dy < depth) {
        const dx = s.pos.x - HOOP.rim.x, dz = s.pos.z - HOOP.rim.z;
        const hl = Math.hypot(dx, dz);
        const t = clamp(dy / depth, 0, 1);
        const netR = HOOP.R * (1 - t) + 0.13 * t;
        if (hl < netR + 0.02 && dy > 0.02) {
          s.inNet = true;
          s.vel.x *= 1 - 3.2 * h; s.vel.z *= 1 - 3.2 * h;
          if (s.vel.y < -1.2) s.vel.y *= 1 - 1.4 * h;
          if (hl > netR - R * 0.55 && hl > 1e-4) {
            const push = (hl - (netR - R * 0.55));
            s.pos.x -= (dx / hl) * push * 0.5; s.pos.z -= (dz / hl) * push * 0.5;
          }
        } else s.inNet = false;
      } else s.inNet = false;
    }
    // score: centre passes down through the rim plane inside the ring
    if (s.lastScoreCheckY >= rimFloor && s.pos.y < rimFloor && s.vel.y < 0) {
      const hl = Math.hypot(s.pos.x - HOOP.rim.x, s.pos.z - HOOP.rim.z);
      if (hl < HOOP.R - R * 0.35 && s.scoredShot !== s.shotId) {
        s.scoredShot = s.shotId;
        onScore?.({ swish: s.rimHitShot !== s.shotId });
      }
    }
    s.lastScoreCheckY = s.pos.y;

    // Kerry
    if (body.active) {
      const ab = tmp.subVectors(body.b, body.a);
      const t = clamp(tmp2.subVectors(s.pos, body.a).dot(ab) / ab.lengthSq(), 0, 1);
      const cp = tmp3.copy(body.a).addScaledVector(ab, t);
      const n = new THREE.Vector3().subVectors(s.pos, cp);
      const dist = n.length();
      if (dist < R + body.r && dist > 1e-5) {
        n.multiplyScalar(1 / dist);
        const sp = contact(n, R + body.r - dist, 0.45, 0.4, body.vel);
        if (sp > 0.8 && performance.now() - s.lastHitKerry > 1500) { s.lastHitKerry = performance.now(); onImpact?.('kerry', sp, s.pos); }
      }
    }

    // rolling resistance on the floor
    if (s.onFloor) {
      s.vel.x *= 1 - 0.25 * h; s.vel.z *= 1 - 0.25 * h;
      s.ang.multiplyScalar(1 - 0.4 * h);
    }
  }

  function step(dt) {
    if (s.held) {
      const target = s.held();
      const prev = tmp.copy(s.pos);
      s.pos.copy(target);
      s.vel.subVectors(s.pos, prev).multiplyScalar(1 / Math.max(dt, 1e-3));
      s.sleeping = false;
    } else if (!s.sleeping) {
      const n = Math.max(4, Math.ceil(s.vel.length() * dt / 0.02));
      const h = Math.min(dt, 1 / 30) / n;
      for (let i = 0; i < n; i++) substep(h);
      // resting on a mattress or bean bag: the soft surface sags and it rolls off
      if (s.vel.lengthSq() < 0.01 && s.pos.y > R + 0.05) {
        for (const c of colliders) {
          if (!c.rolloff) continue;
          if (s.pos.x > c.min.x && s.pos.x < c.max.x && s.pos.z > c.min.z && s.pos.z < c.max.z && s.pos.y < c.max.y + R + 0.05) {
            s.vel.addScaledVector(c.rolloff, 0.9 * dt * 4);
          }
        }
      }
      if (s.onFloor && s.vel.lengthSq() < 0.004 && Math.abs(s.pos.y - R) < 0.003) {
        s.restTime += dt;
        if (s.restTime > 0.6) { s.sleeping = true; s.vel.set(0, 0, 0); s.ang.set(0, 0, 0); s.pos.y = R; }
      } else s.restTime = 0;
    }
    // wake if Kerry walks into it
    if (s.sleeping && body.active) {
      const ab = tmp.subVectors(body.b, body.a);
      const t = clamp(tmp2.subVectors(s.pos, body.a).dot(ab) / ab.lengthSq(), 0, 1);
      if (tmp3.copy(body.a).addScaledVector(ab, t).distanceTo(s.pos) < R + body.r) { s.sleeping = false; substep(1 / 120); }
    }
    // spin integration
    const w = s.ang.length();
    if (w > 1e-4) {
      const dq = new THREE.Quaternion().setFromAxisAngle(tmp.copy(s.ang).multiplyScalar(1 / w), w * dt);
      s.q.premultiply(dq);
    }
    mesh.position.copy(s.pos);
    mesh.quaternion.copy(s.q);
    updateNet(dt);
  }

  return {
    mesh, state: s, R, body,
    step,
    wake() { s.sleeping = false; s.restTime = 0; },
    hold(fn) { s.held = fn; s.sleeping = false; },
    release(vel, spin = null) {
      s.held = null; s.vel.copy(vel); s.sleeping = false; s.restTime = 0;
      if (spin) s.ang.copy(spin);
      s.shotId++;
    },
    isFree() { return !s.held; },
  };
}

// Launch velocity that lands `to` from `from` with a given launch angle.
export function solveShot(from, to, angleDeg = 52) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  const h = to.y - from.y;
  const th = (angleDeg * Math.PI) / 180;
  const denom = 2 * Math.cos(th) ** 2 * (d * Math.tan(th) - h);
  if (denom <= 0) return null;
  const v = Math.sqrt((-G * d * d) / denom);
  return new THREE.Vector3((dx / d) * v * Math.cos(th), v * Math.sin(th), (dz / d) * v * Math.cos(th));
}
