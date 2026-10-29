import * as THREE from 'three';
import { clamp, lerp, damp, angleDamp, angleDiff, easeInOut, rand, pick, smooth, nairobiTime } from './util.js';
import { HOOP } from './room.js';
import { solveShot } from './physics.js';

// Kerry decides for himself. Four needs drift over time; every activity
// satisfies some and drains others. When an activity ends he scores every
// option (need deficits × what the activity gives, time of day in Nairobi,
// a penalty for repeating himself, a little randomness) and picks with a
// softmax, so he is predictable in spirit but never scripted.
//
// Activities are written as generator coroutines: `const dt = yield;` waits
// one frame, which keeps long multi-step behaviours (fetch the controller,
// walk to the bean bag, sit, play, react to goals, stand, put it back) readable.

const UP = new THREE.Vector3(0, 1, 0);

const ACTIVITIES = {
  gaming:   { label: 'Playing a match on the PS5', gives: { fun: 1.0, energy: -0.2, drive: -0.4, move: -0.5 }, dur: [55, 95] },
  coding:   { label: 'Working on the cyberdeck', gives: { drive: 1.0, fun: -0.4, energy: -0.3, move: -0.5 }, dur: [55, 100] },
  guitar:   { label: 'Playing the guitar', gives: { fun: 0.7, energy: 0.1, drive: -0.1, move: -0.3 }, dur: [40, 70] },
  sleep:    { label: 'Asleep', gives: { energy: 2.2, fun: 0.1, move: -0.1 }, dur: [45, 80] },
  dance:    { label: 'Dancing', gives: { fun: 0.8, move: 1.2, energy: -0.6 }, dur: [26, 42] },
  hoops:    { label: 'Shooting hoops', gives: { move: 1.2, fun: 0.7, energy: -0.5 }, dur: [45, 80] },
  board:    { label: 'Thinking at the whiteboard', gives: { drive: 0.7, fun: -0.1, move: 0.1 }, dur: [35, 55] },
  rack:     { label: 'Checking the KerryOS server', gives: { drive: 0.5, fun: -0.1 }, dur: [16, 26] },
};

const THOUGHTS = {
  gaming: { fun: ['One match. Just one.', 'Need to switch my brain off for a bit.', 'Time to get beaten by the CPU again.'], move: ['Sitting down for a game.'], any: ['Time for a quick match.'] },
  coding: { drive: ['Got an idea for the market page. Writing it down in code.', 'Jarvis has drafts waiting. Clearing them.', 'Back to the deck. The build won’t ship itself.'], any: ['Quick fix, then a break. Probably.'] },
  guitar: { fun: ['Hands want something to do.', 'Need something quieter.'], energy: ['Winding down with the guitar.'], any: ['Picking at the guitar for a while.'] },
  sleep: { energy: ['Running on empty. Lying down.', 'Eyes are closing on their own.', 'Done for now. Bed.'], any: ['Nap time.'] },
  dance: { move: ['Too much sitting. Music on.', 'Need to move.'], fun: ['This one’s a tune.'], any: ['Music on.'] },
  hoops: { move: ['Been still too long. Shooting some hoops.', 'Stretching the legs.'], fun: ['Let’s see if the jumper is wet today.'], any: ['Few shots before getting back to it.'] },
  board: { drive: ['Need to think this through before I type.', 'Sketching the next step on the board.'], any: ['Board time.'] },
  rack: { drive: ['Checking the KerryOS box is behaving.', 'Something blinked. Checking the rack.'], any: ['Quick look at the server.'] },
};

export class Brain {
  constructor({ kerry, nav, room, ball, audio, screens, camera, ui }) {
    Object.assign(this, { kerry, nav, room, ball, audio, screens, camera, ui });
    this.props = room.props; this.anchors = room.anchors;
    const h = nairobiTime().hours;
    const night = h >= 22 || h < 6;
    this.needs = {
      energy: clamp(rand(0.35, 0.9) - (night ? 0.35 : 0), 0.06, 1),
      fun: rand(0.25, 0.85), drive: rand(0.25, 0.85), move: rand(0.2, 0.8),
    };
    this.history = [];
    this.activity = null; this.co = null; this.cleanup = null;
    this.status = ''; this.detail = ''; this.thought = '';
    this.heading = 0;
    this.pose = this.kerry.p;
    this.reactT = 0; this.reactLook = null;
    this.stepDist = 0;
    this.held = { controller: null, guitar: null };
    this.makes = 0; this.shots = 0;
    this.time = 0;
    this.carryBall = false;
  }

  // -------------------------------------------------------------- choosing
  scoreAll() {
    const N = this.needs, h = nairobiTime().hours;
    const lateNight = h >= 23 || h < 6, evening = h >= 18 && h < 23, morning = h >= 6 && h < 11;
    const scores = {};
    for (const [k, a] of Object.entries(ACTIVITIES)) {
      let s = 0;
      for (const [need, g] of Object.entries(a.gives)) s += g * (1 - N[need]) * (g > 0 ? 1.2 : 0.35);
      if (k === 'sleep') {
        if (N.energy > 0.3 && !(lateNight && N.energy < 0.55)) s = -1;
        else s += (lateNight ? 0.6 : 0) + (1 - N.energy) * 0.8;
      }
      if (k === 'gaming' && evening) s += 0.15;
      if (k === 'coding' && (morning || lateNight)) s += 0.12;
      if (k === 'rack') s -= 0.12;
      if (k === 'gaming') s += 0.08;
      if (k === 'dance') s -= 0.06;
      // he won't start a shootaround while the ball is stuck somewhere he can't reach
      if (k === 'hoops' && this.ballLost && this.ball.state.pos.distanceTo(this.ballLost) < 0.2) s = -2;
      if ((k === 'dance' || k === 'hoops') && N.energy < 0.25) s -= 0.5;
      const last = this.history[this.history.length - 1], prev = this.history[this.history.length - 2];
      if (k === last) s -= 0.45;
      if (k === prev) s -= 0.15;
      s += rand(0, 0.14);
      scores[k] = s;
    }
    return scores;
  }

  choose() {
    const sc = this.scoreAll();
    const keys = Object.keys(sc);
    const T = 0.1;
    const max = Math.max(...keys.map((k) => sc[k]));
    const w = keys.map((k) => Math.exp((sc[k] - max) / T));
    const tot = w.reduce((a, b) => a + b, 0);
    let r = Math.random() * tot;
    for (let i = 0; i < keys.length; i++) { r -= w[i]; if (r <= 0) return keys[i]; }
    return keys[0];
  }

  reasonFor(k) {
    const a = ACTIVITIES[k];
    let best = 'any', bv = 0;
    for (const [need, g] of Object.entries(a.gives)) {
      const v = g * (1 - this.needs[need]);
      if (g > 0 && v > bv && THOUGHTS[k][need]) { bv = v; best = need; }
    }
    return pick(THOUGHTS[k][best] || THOUGHTS[k].any);
  }

  start(k, { instant = false } = {}) {
    this.activity = k;
    this.history.push(k); if (this.history.length > 6) this.history.shift();
    this.endAt = this.time + rand(...ACTIVITIES[k].dur) * (instant ? rand(0.4, 0.8) : 1);
    this.status = ACTIVITIES[k].label; this.detail = '';
    this.say(this.reasonFor(k), 6);
    this.co = this[k](instant);
    this.co.next();
  }

  begin() {
    // a visitor walks in on him in the middle of something
    const forced = new URLSearchParams(location.search).get('act');
    const k = forced && ACTIVITIES[forced] ? forced : this.choose();
    this.start(k, { instant: true });
  }

  say(text, dur = 4) { this.thought = text; this.thoughtUntil = this.time + dur; this.ui?.onThought?.(text); }

  // -------------------------------------------------------------- frame
  update(dt) {
    this.time += dt;
    const a = ACTIVITIES[this.activity];
    if (a) {
      const N = this.needs;
      // time passing: he gets bored, restless, itchy to build, and slowly tired
      const base = { energy: this.activity === 'sleep' ? 0 : 0.0007, fun: 0.0032, drive: 0.0034, move: 0.003 };
      for (const k of Object.keys(N)) N[k] -= base[k] * dt;
      for (const [need, g] of Object.entries(a.gives)) N[need] += (g > 0 ? g * 0.0095 : g * (need === 'energy' ? 0.0028 : 0.004)) * dt;
      for (const k of Object.keys(N)) N[k] = clamp(N[k], 0, 1);
    }
    if (this.co) {
      const r = this.co.next(dt);
      if (r.done) { this.co = null; this.next(); }
    } else this.next();

    // carrying: keep a hand on whatever he is holding
    if (!this.handsBusy) {
      if (this.held.guitar && this.held.guitar !== 'play') {
        const neck = this.props.guitar.group.localToWorld(this.props.guitar.fretPos(4));
        this.pose.hands.l = neck; this.pose.hands.wl = damp(this.pose.hands.wl, 1, 8, dt);
        this.pose.hands.poleL = this.kerry.toWorld(new THREE.Vector3(0.6, 0.4, -0.4));
      }
      if (this.held.controller === 'carry') {
        this.pose.hands.r = this.kerry.toWorld(new THREE.Vector3(-0.2, 0.92, 0.24)); this.pose.hands.wr = damp(this.pose.hands.wr, 1, 8, dt);
        this.pose.hands.poleR = this.kerry.toWorld(new THREE.Vector3(-0.6, 0.4, -0.4));
      }
    }

    // visitor reactions overlay
    if (this.reactT > 0) {
      this.reactT -= dt;
      const w = smooth(clamp(Math.min(this.reactT, 2.6 - this.reactT) * 3, 0, 1));
      this.pose.look = this.camera.position.clone();
      this.pose.lookW = Math.max(this.pose.lookW, w);
      if (this.reactWave && !this.seated && this.pose.hands.wr < 0.5) {
        const wave = this.kerry.toWorld(new THREE.Vector3(-0.32, 1.62 + Math.sin(this.time * 9) * 0.02, 0.12 + Math.sin(this.time * 9) * 0.07));
        this.pose.hands.r = wave; this.pose.hands.wr = w; this.pose.hands.poleR = this.kerry.toWorld(new THREE.Vector3(-0.8, 1.0, -0.3));
      }
      if (this.reactT <= 0) { this.reactWave = false; if (!this.handsBusy) { this.pose.hands.wr = 0; } }
    }
    this.kerry.root.updateMatrixWorld(true);
  }

  next() {
    this.kerry.resetLayer();
    this.seated = false;
    const k = this.choose();
    this.start(k);
  }

  timeUp() { return this.time > this.endAt || this.needs.energy < 0.05 && this.activity !== 'sleep'; }

  // visitor clicked Kerry
  poke() {
    if (this.activity === 'sleep' && this.lying) { this.say('Mm. Five more minutes.', 3); this.reactT = 1.2; return; }
    this.reactT = 2.6; this.reactWave = !this.seated;
    this.say(pick(['Hey! Welcome in.', 'Oh, hi. Have a look around.', 'Hey. Click around, I don’t mind.']), 3.5);
    if (!this.seated && this.kerry.has('talk') && !this.walking && this.activity !== 'dance' && this.activity !== 'hoops') {
      this.kerry.play('talk', 0.3);
      clearTimeout(this._talkT);
      this._talkT = setTimeout(() => { if (this.kerry.currentName === 'talk') this.kerry.play('idle', 0.4); }, 2400);
    }
  }
  hitByBall() {
    if (this.activity === 'sleep') { this.say('...what was that?', 3); this.reactT = 1.6; return; }
    this.say(pick(['Hey! Watch it.', 'Okay, okay, I see you.', 'Nice arm. Wrong target.']), 3);
    this.reactT = 2.2;
  }

  // ============================================================== motion helpers
  setRoot(pos, heading) {
    this.kerry.root.position.copy(pos);
    this.heading = heading;
    this.kerry.root.rotation.set(0, heading, 0);
  }

  *turnTo(angle, speed = 5) {
    this.kerry.play('idle', 0.3);
    while (Math.abs(angleDiff(this.heading, angle)) > 0.04) {
      const dt = yield;
      this.heading = angleDamp(this.heading, angle, speed, dt);
      this.kerry.root.rotation.y = this.heading;
    }
  }

  *walkTo(target, { facing = null, run = false, stopShort = 0 } = {}) {
    const root = this.kerry.root;
    let path = this.nav.path(root.position, target);
    const reachedTarget = path.length && path[path.length - 1].distanceTo(target.clone().setY(0)) < 0.12;
    if (stopShort > 0 && path.length > 1 && reachedTarget) {
      const end = path[path.length - 1], prev = path[path.length - 2];
      const d = end.distanceTo(prev);
      if (d > stopShort) end.lerp(prev, stopShort / d); else path.pop();
    }
    if (path.length < 2 || root.position.distanceTo(path[path.length - 1]) < 0.06) {
      if (facing !== null) yield* this.turnTo(facing);
      return;
    }
    this.walking = true;
    const speed = run ? 2.3 : 1.12;
    let i = 1;
    let v = 0;
    // turn toward the first waypoint before stepping off if the angle is large
    const first = path[1];
    const ang0 = Math.atan2(first.x - root.position.x, first.z - root.position.z);
    if (Math.abs(angleDiff(this.heading, ang0)) > 1.6) yield* this.turnTo(ang0, 7);
    this.kerry.play(run && this.kerry.has('jog') ? 'jog' : 'walk', 0.25);
    while (i < path.length) {
      const dt = yield;
      const wp = path[i];
      const to = new THREE.Vector3(wp.x - root.position.x, 0, wp.z - root.position.z);
      const dist = to.length();
      const remaining = dist + path.slice(i + 1).reduce((acc, p, k) => acc + p.distanceTo(path[i + k]), 0);
      const want = Math.min(speed, remaining * 2.2 + 0.15);
      v = damp(v, want, 6, dt);
      const ang = Math.atan2(to.x, to.z);
      this.heading = angleDamp(this.heading, ang, 9, dt);
      root.rotation.y = this.heading;
      const stepLen = Math.min(dist, v * dt);
      // move along heading blended with direct direction (avoid sliding sideways)
      const fwd = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
      const dir = to.normalize().lerp(fwd, 0.4).normalize();
      root.position.addScaledVector(dir, stepLen);
      this.kerry.current && (this.kerry.current.timeScale = clamp(v / (run ? 2.3 : 1.12), 0.4, 1.25));
      this.stepDist += stepLen;
      if (this.stepDist > (run ? 0.9 : 0.68)) { this.stepDist = 0; this.audio.sfx.step(root.position.clone().setY(0.05)); }
      if (dist < 0.08) i++;
    }
    this.walking = false;
    this.kerry.play('idle', 0.35);
    if (facing !== null) yield* this.turnTo(facing);
  }

  *wait(sec, fn = null) {
    let t = 0;
    while (t < sec) { const dt = yield; t += dt; fn?.(t, dt); }
  }

  *tween(dur, fn) {
    let t = 0;
    while (t < dur) { const dt = yield; t = Math.min(dur, t + dt); fn(easeInOut(t / dur), dt); }
  }

  // sit down onto a world-space hip position, feet planted at local offsets
  *sit(seat, { feetLocal = [new THREE.Vector3(0.14, 0, 0.42), new THREE.Vector3(-0.14, 0, 0.42)], lean = 0, dur = 0.9 } = {}) {
    const P = this.pose;
    const startHip = this.kerry.wp('hips');
    const rootStart = this.kerry.root.position.clone();
    const back = seat.clone().setY(0);
    this.audio.sfx.chair(seat);
    P.seat = startHip.clone();
    yield* this.tween(dur, (t) => {
      // root drifts so that the seat ends up under the hips
      const hipNow = startHip.clone().lerp(seat, t);
      hipNow.y = lerp(startHip.y, seat.y, smooth(t));
      P.seat = hipNow; P.seatW = 1;
      this.kerry.root.position.lerpVectors(rootStart, back, t);
      P.feet.l = this.kerry.toWorld(feetLocal[0]); P.feet.r = this.kerry.toWorld(feetLocal[1]); P.feet.w = t;
      P.lean = lean * t;
    });
    this.seated = true;
  }

  *standUp(to, dur = 0.85) {
    const P = this.pose;
    const seat = P.seat ? P.seat.clone() : this.kerry.wp('hips');
    const rootStart = this.kerry.root.position.clone();
    const lean0 = P.lean;
    this.seated = false;
    yield* this.tween(dur, (t) => {
      this.kerry.root.position.lerpVectors(rootStart, to, t);
      P.seat = seat.clone().lerp(this.kerry.toWorld(new THREE.Vector3(0, this.kerry.hipsRestWorldY, 0)), t);
      P.seatW = 1 - smooth(Math.max(0, (t - 0.55) / 0.45));
      P.feet.w = 1 - t;
      P.lean = lerp(lean0, 0.35, Math.sin(t * Math.PI)) * (1 - t) + 0;
    });
    P.seatW = 0; P.feet.w = 0; P.lean = 0; P.seat = null;
  }

  *reach(targetFn, hand = 'r', dur = 0.5, hold = 0.15) {
    const H = this.pose.hands;
    yield* this.tween(dur, (t) => {
      const tgt = targetFn();
      if (hand === 'r' || hand === 'both') { H.r = tgt.clone(); H.wr = t; }
      if (hand === 'l' || hand === 'both') { H.l = tgt.clone(); H.wl = t; }
      this.pose.lean = t * 0.25;
      this.pose.look = tgt.clone(); this.pose.lookW = t;
    });
    yield* this.wait(hold);
  }

  *releaseHands(dur = 0.4) {
    const H = this.pose.hands, wl = H.wl, wr = H.wr, lean = this.pose.lean, lk = this.pose.lookW;
    yield* this.tween(dur, (t) => { H.wl = wl * (1 - t); H.wr = wr * (1 - t); this.pose.lean = lean * (1 - t); this.pose.lookW = lk * (1 - t); });
    H.wl = H.wr = 0;
  }

  localToWorld(x, y, z) { return this.kerry.toWorld(new THREE.Vector3(x, y, z)); }

  // place a prop rigidly in Kerry's local frame
  placeInHands(obj, localPos, localEuler) {
    const m = new THREE.Matrix4().compose(localPos, new THREE.Quaternion().setFromEuler(localEuler), new THREE.Vector3(1, 1, 1));
    m.premultiply(this.kerry.root.matrixWorld);
    m.decompose(obj.position, obj.quaternion, new THREE.Vector3());
    if (obj.parent && obj.parent !== this.kerry.root.parent) {
      // props live inside room sub-groups at identity transform, so world == local
    }
  }

  // ============================================================== activities
  *gaming(instant) {
    const A = this.anchors.gaming, P = this.pose, ctrl = this.props.controller, rest = this.props.controllerRest;
    const tv = this.screens.tv;
    const ctrlLocalLap = new THREE.Vector3(0.0, 0.64, 0.34), ctrlEulerLap = new THREE.Euler(-0.5, 0, 0);
    const ctrlLocalCarry = new THREE.Vector3(-0.2, 0.92, 0.22), ctrlEulerCarry = new THREE.Euler(-0.8, 0.2, 0);
    const grips = () => {
      const c = this.localToWorld(ctrlLocalLap.x, ctrlLocalLap.y, ctrlLocalLap.z);
      return [this.localToWorld(0.075, ctrlLocalLap.y + 0.01, ctrlLocalLap.z - 0.02), this.localToWorld(-0.075, ctrlLocalLap.y + 0.01, ctrlLocalLap.z - 0.02), c];
    };
    const sitDown = function* () {
      yield* this.sit(A.seat.clone(), { feetLocal: [new THREE.Vector3(0.17, 0, 0.5), new THREE.Vector3(-0.17, 0, 0.5)], lean: -0.12 });
    }.bind(this);

    if (instant) {
      this.setRoot(A.seat.clone().setY(0), A.facing);
      this.kerry.root.updateMatrixWorld(true);
      P.seat = A.seat.clone(); P.seatW = 1; P.feet.w = 1; P.lean = -0.12;
      P.feet.l = this.localToWorld(0.17, 0, 0.5); P.feet.r = this.localToWorld(-0.17, 0, 0.5);
      this.seated = true;
    } else {
      // fetch the controller from the credenza
      yield* this.walkTo(new THREE.Vector3(-2.72, 0, rest.pos.z + 0.05), { facing: -Math.PI / 2 });
      yield* this.reach(() => ctrl.position.clone().add(new THREE.Vector3(0.02, 0.02, 0)), 'r', 0.55);
      this.held.controller = 'carry';
      this.audio.sfx.pad(ctrl.position);
      yield* this.releaseHands(0.2);
      yield* this.walkTo(A.approach.clone(), { facing: A.facing });
      yield* this.turnTo(A.facing);
      yield* sitDown();
    }
    this.handsBusy = true;
    this.held.controller = 'lap';
    tv.mode = 'game'; tv.skill = 0.55 + this.needs.fun * 0.2;
    let celebrate = 0, groan = 0, inputT = 0;
    tv.onGoal = (mine) => {
      if (mine) { celebrate = 1.6; this.say(pick(['Get in!', 'Top bins.', 'That’s how you do it.']), 2.5); this.audio.sfx.cheer(this.props.tvCenter); }
      else { groan = 1.6; this.say(pick(['No way that went in.', 'Defending like a Sunday league side.', 'CPU is cheating.']), 2.5); }
      this.audio.sfx.whistle(this.props.tvCenter);
    };
    this.audio.setCrowd(1, this.props.tvCenter);
    let lookAway = 0;
    while (!this.timeUp()) {
      const dt = yield;
      const [gl, gr] = grips();
      const jit = (s) => new THREE.Vector3(rand(-1, 1) * s, rand(-1, 1) * s, rand(-1, 1) * s);
      inputT -= dt;
      if (inputT < 0) { inputT = rand(0.08, 0.35); tv.input(); if (Math.random() < 0.3) this.audio.sfx.pad(gl); }
      if (celebrate > 0) {
        celebrate -= dt;
        const up = Math.sin(clamp(1.6 - celebrate, 0, 1.6) / 1.6 * Math.PI);
        P.hands.l = gl.clone().lerp(this.localToWorld(0.25, 1.35, 0.2), up); P.hands.r = gr.clone().lerp(this.localToWorld(-0.25, 1.35, 0.2), up);
        P.lean = -0.12 - up * 0.15;
      } else {
        P.hands.l = gl.add(jit(0.004)); P.hands.r = gr.add(jit(0.004));
        P.lean = groan > 0 ? 0.25 : damp(P.lean, -0.08 + Math.sin(this.time * 0.6) * 0.04, 2, dt);
        groan = Math.max(0, groan - dt);
      }
      P.hands.wl = P.hands.wr = 1;
      P.hands.poleL = this.localToWorld(0.5, 0.4, -0.2); P.hands.poleR = this.localToWorld(-0.5, 0.4, -0.2);
      lookAway -= dt;
      if (lookAway < -rand(6, 14)) lookAway = rand(0.8, 1.6);
      P.look = lookAway > 0 ? this.camera.position.clone() : this.props.tvCenter.clone().add(new THREE.Vector3(0, -0.05, 0));
      P.lookW = 0.9;
      this.detail = `${tv.score[0]}–${tv.score[1]}`;
    }
    // done: stand, put the controller back
    this.handsBusy = false;
    tv.mode = 'off'; tv.onGoal = null;
    this.audio.setCrowd(0);
    yield* this.releaseHands(0.3);
    this.held.controller = 'carry';
    yield* this.standUp(A.approach.clone());
    yield* this.walkTo(new THREE.Vector3(-2.72, 0, rest.pos.z + 0.05), { facing: -Math.PI / 2 });
    yield* this.reach(() => rest.pos.clone(), 'r', 0.5);
    this.held.controller = null;
    ctrl.position.copy(rest.pos); ctrl.rotation.copy(rest.rot);
    yield* this.releaseHands(0.3);
  }

  *coding(instant) {
    const A = this.anchors.coding, P = this.pose, deck = this.props.deck;
    const kb = deck.group.localToWorld(deck.keyboardCenter.clone());
    const ball = deck.group.localToWorld(new THREE.Vector3(0.135, 0.07, 0.03));
    if (instant) {
      this.setRoot(A.seat.clone().setY(0), A.facing);
      this.kerry.root.updateMatrixWorld(true);
      P.seat = A.seat.clone(); P.seatW = 1; P.feet.w = 1; P.lean = 0.12;
      P.feet.l = this.localToWorld(0.14, 0, 0.4); P.feet.r = this.localToWorld(-0.14, 0, 0.4);
      this.seated = true;
    } else {
      yield* this.walkTo(A.approach.clone(), { facing: A.facing });
      yield* this.sit(A.seat.clone(), { lean: 0.12, feetLocal: [new THREE.Vector3(0.14, 0, 0.4), new THREE.Vector3(-0.14, 0, 0.4)] });
    }
    this.handsBusy = true;
    let mouseT = 0, lookT = 0, lookTarget = 'deck';
    const deckScreen = deck.group.localToWorld(new THREE.Vector3(-0.03, 0.17, -0.08));
    const mon = this.props.sokoScreen.getWorldPosition(new THREE.Vector3());
    const mon2 = this.props.stockScreen.getWorldPosition(new THREE.Vector3());
    let w = 0;
    while (!this.timeUp()) {
      const dt = yield;
      w = Math.min(1, w + dt * 2);
      const pressed = this.screens.deck.update(dt, true);
      if (pressed) { deck.pressRandom(); this.audio.sfx.key(kb); }
      mouseT -= dt;
      const usingBall = mouseT > 0;
      if (mouseT < -rand(5, 9)) mouseT = rand(1.2, 2.5);
      const left = new THREE.Vector3(1, 0, 0).transformDirection(this.kerry.root.matrixWorld);
      const tap = (s) => Math.sin(this.time * (17 + s * 3)) * 0.006;
      P.hands.l = kb.clone().addScaledVector(left, 0.07).add(new THREE.Vector3(0, 0.02 + Math.max(0, tap(1)), 0));
      P.hands.r = usingBall ? ball.clone().add(new THREE.Vector3(0, 0.025, 0)) : kb.clone().addScaledVector(left, -0.06).add(new THREE.Vector3(0, 0.02 + Math.max(0, tap(2)), 0));
      P.hands.wl = P.hands.wr = w;
      P.hands.poleL = this.localToWorld(0.5, 0.3, -0.4); P.hands.poleR = this.localToWorld(-0.5, 0.3, -0.4);
      lookT -= dt;
      if (lookT < 0) { lookT = rand(2, 6); lookTarget = pick(['deck', 'deck', 'mon', 'mon', 'mon2', Math.random() < 0.15 ? 'cam' : 'deck']); }
      const lt = lookTarget === 'deck' ? deckScreen : lookTarget === 'mon' ? mon : lookTarget === 'mon2' ? mon2 : this.camera.position;
      P.look = (P.look || lt.clone()).lerp(lt, 1 - Math.exp(-dt * 5)); P.lookW = 0.95;
      P.lean = damp(P.lean, 0.14 + Math.sin(this.time * 0.3) * 0.04, 2, dt);
      this.detail = 'Jarvis shell';
    }
    this.handsBusy = false;
    yield* this.releaseHands(0.35);
    yield* this.standUp(A.approach.clone());
  }

  *guitar(instant) {
    const A = this.anchors.guitar, P = this.pose, G = this.props.guitar, rest = this.props.guitarRest;
    const playLocal = { pos: new THREE.Vector3(0.05, 0.53, 0.2), rot: new THREE.Euler(0.1, 0.15, -Math.PI / 2 + 0.28) };
    const carryLocal = { pos: new THREE.Vector3(0.27, 0.62, 0.05), rot: new THREE.Euler(0, Math.PI / 2, 0.08) };
    if (instant) {
      this.setRoot(A.seat.clone().setY(0), A.facing);
      this.kerry.root.updateMatrixWorld(true);
      P.seat = A.seat.clone(); P.seatW = 1; P.feet.w = 1;
      P.feet.l = this.localToWorld(0.16, 0, 0.42); P.feet.r = this.localToWorld(-0.16, 0, 0.42);
      this.seated = true;
    } else {
      const standAp = new THREE.Vector3(1.62, 0, -0.05);
      yield* this.walkTo(standAp, { facing: Math.atan2(rest.pos.x - standAp.x, rest.pos.z - standAp.z) });
      yield* this.reach(() => G.group.localToWorld(G.fretPos(3)), 'l', 0.5);
      this.held.guitar = carryLocal;
      yield* this.releaseHands(0.2);
      yield* this.walkTo(A.approach.clone(), { facing: A.facing });
      yield* this.sit(A.seat.clone(), { feetLocal: [new THREE.Vector3(0.16, 0, 0.42), new THREE.Vector3(-0.16, 0, 0.42)] });
    }
    this.held.guitar = playLocal;
    this.handsBusy = true;
    this.audio.setGuitarPos(this.kerry.root.position.clone().setY(0.8));
    // House of the Rising Sun (traditional), fingerpicked in 6/8, A minor
    const chords = {
      Am: { n: [null, 45, 52, 57, 60, 64], root: 1, fret: 1.6 },
      C: { n: [null, 48, 52, 55, 60, 64], root: 1, fret: 2.4 },
      D: { n: [null, null, 50, 57, 62, 66], root: 2, fret: 2.3 },
      F: { n: [41, 48, 53, 57, 60, 65], root: 0, fret: 1.4 },
      E: { n: [40, 47, 52, 56, 59, 64], root: 0, fret: 1.5 },
    };
    const prog = ['Am', 'C', 'D', 'F', 'Am', 'C', 'E', 'E', 'Am', 'C', 'D', 'F', 'Am', 'E', 'Am', 'E'];
    const eighth = 0.205;
    const pattern = (c) => [c.root, 3, 4, 5, 4, 3];
    let songT = 0, nextIdx = 0, scheduledIdx = 0;
    const totalNotes = prog.length * 6;
    let fretSmoothed = chords.Am.fret, pickPhase = 0, lastString = 3;
    let lookT = 0, lookCam = false;
    let w = instant ? 1 : 0;
    while (!this.timeUp()) {
      const dt = yield;
      w = Math.min(1, w + dt * 1.5);
      songT += dt;
      // schedule audio slightly ahead
      while (this.audio.enabled && scheduledIdx < nextIdx + 8 && (scheduledIdx * eighth) < songT + 0.12 + (Math.floor(scheduledIdx / totalNotes) * 0)) {
        const k = scheduledIdx % totalNotes, ch = chords[prog[Math.floor(k / 6)]], s = pattern(ch)[k % 6];
        const midi = ch.n[s];
        if (midi) this.audio.pluck(midi, scheduledIdx * eighth - songT, k % 6 === 0 ? 0.62 : 0.42);
        scheduledIdx++;
      }
      if (!this.audio.enabled) scheduledIdx = Math.max(scheduledIdx, nextIdx);
      // visual events
      while (nextIdx * eighth <= songT) {
        const k = nextIdx % totalNotes, ch = chords[prog[Math.floor(k / 6)]], s = pattern(ch)[k % 6];
        if (ch.n[s]) G.pluck(s, k % 6 === 0 ? 1.3 : 1);
        lastString = s; pickPhase = 1;
        nextIdx++;
      }
      const curChord = chords[prog[Math.floor((nextIdx % totalNotes) / 6)]];
      fretSmoothed = damp(fretSmoothed, curChord.fret, 10, dt);
      pickPhase = Math.max(0, pickPhase - dt * 6);
      // hands
      const fret = G.group.localToWorld(G.fretPos(fretSmoothed).add(new THREE.Vector3(0.0, 0, -0.012)));
      const strum = G.group.localToWorld(G.strumPos.clone().add(new THREE.Vector3(0, (lastString - 2.5) * 0.005 + pickPhase * 0.006, 0.01 - pickPhase * 0.008)));
      P.hands.l = fret; P.hands.r = strum; P.hands.wl = P.hands.wr = w;
      P.hands.poleL = this.localToWorld(0.45, 0.2, -0.5); P.hands.poleR = this.localToWorld(-0.6, 0.9, -0.3);
      lookT -= dt;
      if (lookT < 0) { lookCam = Math.random() < 0.3; lookT = lookCam ? rand(1.5, 3) : rand(3, 8); }
      P.look = lookCam ? this.camera.position.clone() : G.group.localToWorld(new THREE.Vector3(0, 0.2, 0.2));
      P.lookW = 0.85;
      P.lean = damp(P.lean, 0.18, 2, dt);
      G.update(dt);
      this.detail = `${prog[Math.floor((nextIdx % totalNotes) / 6)]}`;
    }
    this.handsBusy = false;
    yield* this.releaseHands(0.3);
    this.held.guitar = carryLocal;
    yield* this.standUp(A.approach.clone());
    const standAp = new THREE.Vector3(1.62, 0, -0.05);
    yield* this.walkTo(standAp, { facing: Math.atan2(rest.pos.x - standAp.x, rest.pos.z - standAp.z) });
    yield* this.reach(() => rest.pos.clone().add(new THREE.Vector3(0, 0.25, 0)), 'l', 0.45);
    this.held.guitar = null;
    G.group.position.copy(rest.pos); G.group.rotation.copy(rest.rot);
    yield* this.releaseHands(0.3);
  }

  *sleep(instant) {
    const A = this.anchors.sleep, P = this.pose, bed = this.props.bed;
    const lieRoot = new THREE.Vector3(2.62, 0.66, -0.98);
    const lieQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ'));
    const setDuvet = (t) => {
      bed.setCover(t);
      // the throw gets folded away while he sleeps
      bed.throwM.visible = t < 0.25;
    };
    if (instant) {
      this.kerry.root.position.copy(lieRoot);
      this.kerry.root.quaternion.copy(lieQ);
      this.heading = 0;
      P.lie = 1; this.lying = true; setDuvet(1);
      this.ui.lamps.bed = 0;
    } else {
      yield* this.walkTo(A.approach.clone(), { facing: Math.PI / 2 });
      this.audio.sfx.yawn(this.kerry.wp('head'));
      this.say(pick(['*yawn*', 'Lights out.', 'Okay. Bed.']), 2.5);
      // stretch before lying down
      yield* this.tween(1.0, (t) => {
        const up = Math.sin(t * Math.PI);
        P.hands.l = this.localToWorld(0.2, 1.9, 0.05); P.hands.r = this.localToWorld(-0.2, 1.9, 0.05);
        P.hands.wl = P.hands.wr = up; P.lean = -0.15 * up;
      });
      P.hands.wl = P.hands.wr = 0; P.lean = 0;
      this.ui.lamps.bed = 0;
      const q0 = this.kerry.root.quaternion.clone(), p0 = this.kerry.root.position.clone();
      const mid = new THREE.Vector3(2.15, 0.62, -1.4);
      yield* this.tween(1.8, (t) => {
        const a = smooth(t);
        const p = t < 0.5 ? p0.clone().lerp(mid, a * 2) : mid.clone().lerp(lieRoot, (a - 0.5) * 2);
        p.y = lerp(p0.y, lieRoot.y, smooth(clamp(t * 1.4, 0, 1))) + Math.sin(t * Math.PI) * 0.12;
        this.kerry.root.position.copy(p);
        this.kerry.root.quaternion.copy(q0).slerp(lieQ, smooth(clamp((t - 0.15) / 0.75, 0, 1)));
        P.lie = t; setDuvet(clamp((t - 0.6) / 0.4, 0, 1));
      });
      this.lying = true; P.lie = 1;
    }
    this.kerry.play('idle', 0.6, 0.35);
    let zt = 0;
    while (!this.timeUp() || this.needs.energy < 0.55) {
      const dt = yield;
      this.kerry.current && (this.kerry.current.timeScale = 0.3);
      P.lookW = 0;
      zt += dt;
      if (zt > 2.4) { zt = 0; this.ui.zzz?.(this.kerry.wp('head')); }
      if (this.time > this.endAt + 40) break;
    }
    // wake up
    this.ui.lamps.bed = null;
    this.say(pick(['Okay. I’m up.', 'How long was I out?', 'Right. Back to it.']), 3);
    const q0 = this.kerry.root.quaternion.clone(), p0 = this.kerry.root.position.clone();
    const upright = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
    const stand = A.approach.clone();
    yield* this.tween(1.7, (t) => {
      const a = smooth(t);
      setDuvet(1 - clamp(t * 1.6, 0, 1));
      const mid = new THREE.Vector3(2.0, 0.62, -1.45);
      const p = t < 0.5 ? p0.clone().lerp(mid, a * 2) : mid.clone().lerp(stand, (a - 0.5) * 2);
      p.y = lerp(p0.y, 0, smooth(clamp((t - 0.3) / 0.7, 0, 1))) + Math.sin(t * Math.PI) * 0.1;
      this.kerry.root.position.copy(p);
      this.kerry.root.quaternion.copy(q0).slerp(upright, smooth(clamp(t / 0.8, 0, 1)));
      P.lie = 1 - t;
    });
    this.kerry.root.quaternion.copy(upright);
    this.heading = Math.PI / 2;
    this.kerry.root.rotation.set(0, this.heading, 0);
    this.kerry.root.position.y = 0;
    P.lie = 0; this.lying = false;
    setDuvet(0);
    this.needs.energy = Math.max(this.needs.energy, 0.75);
  }

  *dance(instant) {
    const A = this.anchors.dance, P = this.pose;
    const camFacing = () => { const c = this.camera.position; return Math.atan2(c.x - A.pos.x, c.z - A.pos.z); };
    if (instant) this.setRoot(A.pos.clone(), camFacing());
    else yield* this.walkTo(A.pos.clone(), { facing: camFacing() });
    const tv = this.screens.tv;
    tv.mode = 'viz';
    let beatPulse = 0;
    this.audio.startGroove(this.props.soundbar.pos, (s) => { if (s % 4 === 0) beatPulse = 1; });
    this.kerry.play('dance', 0.5, 1);
    let t = 0;
    while (!this.timeUp()) {
      const dt = yield;
      t += dt;
      if (!this.audio.enabled) { if (Math.floor(t * this.audio.BPM / 60) !== Math.floor((t - dt) * this.audio.BPM / 60)) beatPulse = 1; }
      beatPulse = Math.max(0, beatPulse - dt * 5);
      this.beat = beatPulse;
      tv.energy = 0.4 + beatPulse * 0.6;
      // keep facing the visitor as the clip turns him a little
      this.heading = angleDamp(this.heading, camFacing(), 0.6, dt);
      this.kerry.root.rotation.y = this.heading;
      if (Math.random() < dt * 0.15) { P.look = this.camera.position.clone(); P.lookW = 0.6; }
      else P.lookW = damp(P.lookW, 0, 0.5, dt);
    }
    this.beat = 0;
    this.audio.stopGroove();
    tv.mode = 'off';
    this.kerry.play('idle', 0.6);
    yield* this.wait(0.6);
  }

  // ---------------------------------------------------------------- hoops
  ballTarget() {
    // aim a touch past centre toward the board
    return HOOP.rim.clone().add(new THREE.Vector3(0, 0.02, -0.03));
  }

  *fetchBall() {
    const B = this.ball, P = this.pose;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) yield* this.wait(1.2);
      // let it settle first
      let t = 0;
      while (B.state.vel.length() > 1.2 && t < 4) { const dt = yield; t += dt; P_lookBall(this); }
      if (!B.isFree()) { this.say('Pass it back!', 2); yield* this.wait(1.5); continue; }
      // aim for where it's rolling to
      const bp = B.state.pos.clone().addScaledVector(B.state.vel, 0.6);
      if (B.state.pos.y > 1.4) continue;
      yield* this.walkTo(bp.clone().setY(0), { stopShort: 0.45, run: bp.distanceTo(this.kerry.root.position) > 2.5 });
      const d = this.kerry.root.position.distanceTo(B.state.pos.clone().setY(0));
      if (d > 1.05 || !B.isFree()) continue;
      yield* this.turnTo(Math.atan2(B.state.pos.x - this.kerry.root.position.x, B.state.pos.z - this.kerry.root.position.z), 8);
      // crouch for low balls, bend and stretch for raised ones
      const low = B.state.pos.y < 0.4;
      const far = clamp((d - 0.45) / 0.6, 0, 1);
      yield* this.tween(0.6, (tt) => {
        P.crouch = (low ? 0.38 : 0.06) * tt; P.lean = (low ? 0.55 : 0.25 + far * 0.4) * tt;
        const bpos = B.state.pos;
        const left = new THREE.Vector3(1, 0, 0).transformDirection(this.kerry.root.matrixWorld);
        P.hands.l = bpos.clone().addScaledVector(left, B.R + 0.01); P.hands.r = bpos.clone().addScaledVector(left, -B.R - 0.01);
        P.hands.wl = P.hands.wr = tt; P.look = bpos.clone(); P.lookW = tt;
      });
      if (!B.isFree()) continue;
      this.carryBall = true;
      B.hold(() => this.handBallPos());
      yield* this.tween(0.45, (tt) => { P.crouch = (low ? 0.38 : 0.06) * (1 - tt); P.lean = (low ? 0.55 : 0.25 + far * 0.4) * (1 - tt); });
      P.crouch = 0; P.lean = 0;
      this.ballLost = null;
      return true;
    }
    this.ballLost = B.state.pos.clone();
    return false;
  }

  handBallPos() {
    // ball held at chest by default; activities override via this.ballLocal
    const l = this.ballLocal || new THREE.Vector3(0, 1.05, 0.28);
    return this.kerry.toWorld(l);
  }

  *hoops(instant) {
    const P = this.pose, B = this.ball;
    if (instant) {
      this.setRoot(new THREE.Vector3(0.85, 0, 0.1), Math.PI);
      this.kerry.root.updateMatrixWorld(true);
      this.carryBall = true;
      B.hold(() => this.handBallPos());
    }
    let shots = 0;
    this.makes = 0; this.shots = 0;
    this.handsBusy = true;
    while (!this.timeUp() || shots === 0) {
      if (!this.carryBall) {
        const ok = yield* this.fetchBall();
        if (!ok) { this.say(pick(['Can\u2019t reach the ball. Forget it.', 'Ball\u2019s stuck. Next time.']), 3); break; }
      }
      // pick a spot in front of the hoop and dribble there
      let spot = null;
      for (let k = 0; k < 40 && !spot; k++) {
        const ang = rand(-1.0, 1.0), dist = rand(1.6, 3.2);
        const p = new THREE.Vector3(HOOP.rim.x + Math.sin(ang) * dist, 0, HOOP.rim.z + Math.cos(ang) * dist);
        if (p.z > -1.6 && p.x > -0.4 && p.x < 3.2 && p.z < 2.6 && this.nav.isFree(p)) spot = p;
      }
      spot ||= new THREE.Vector3(0.8, 0, 0.4);
      const faceHoop = () => Math.atan2(HOOP.rim.x - this.kerry.root.position.x, HOOP.rim.z - this.kerry.root.position.z);
      // dribble while walking
      let phase = 0, lastPhase = 0;
      this.dribbling = true;
      const dribbleBall = () => {
        const y = B.R + (0.92 - B.R) * Math.abs(Math.cos(Math.PI * phase));
        return this.kerry.toWorld(new THREE.Vector3(-0.24, y, 0.32));
      };
      B.hold(dribbleBall);
      const walk = this.walkTo(spot, { facing: null });
      walk.next();
      let res = { done: false };
      while (!res.done) {
        const dt = yield;
        phase += dt * 1.9;
        if (Math.floor(phase + 0.5) !== Math.floor(lastPhase + 0.5)) this.audio.sfx.bounce(3.2, B.state.pos.clone().setY(0.1));
        lastPhase = phase;
        const bp = dribbleBall();
        P.hands.r = bp.clone().add(new THREE.Vector3(0, B.R + 0.02, 0)); P.hands.r.y = Math.max(P.hands.r.y, 0.72);
        P.hands.wr = 1; P.hands.wl = 0; P.hands.poleR = this.localToWorld(-0.6, 0.6, -0.4);
        P.look = HOOP.rim.clone(); P.lookW = 0.4;
        res = walk.next(dt);
      }
      // settle the ball into both hands at the chest
      this.dribbling = false;
      this.ballLocal = new THREE.Vector3(-0.03, 1.08, 0.3);
      B.hold(() => this.handBallPos());
      yield* this.turnTo(faceHoop(), 7);
      // gather -> rise -> release -> follow-through
      const left = () => new THREE.Vector3(1, 0, 0).transformDirection(this.kerry.root.matrixWorld);
      const fwdV = () => new THREE.Vector3(0, 0, 1).transformDirection(this.kerry.root.matrixWorld);
      const handsOnBall = () => {
        const b = this.handBallPos();
        P.hands.l = b.clone().addScaledVector(left(), B.R + 0.012).add(new THREE.Vector3(0, 0.01, 0));
        P.hands.r = b.clone().addScaledVector(fwdV(), -B.R - 0.015).addScaledVector(left(), -0.02).add(new THREE.Vector3(0, -0.04, 0));
        P.hands.wl = P.hands.wr = 1;
        P.hands.poleL = this.localToWorld(0.6, 0.3, -0.2); P.hands.poleR = this.localToWorld(-0.5, 0.1, -0.3);
      };
      P.look = HOOP.rim.clone(); P.lookW = 0.9;
      yield* this.tween(0.45, (t) => { P.crouch = 0.13 * t; this.ballLocal.set(-0.03, 1.08 - 0.12 * t, 0.3); handsOnBall(); });
      const fatigue = 1 - this.needs.energy;
      const baseY = 0;
      yield* this.tween(0.32, (t) => {
        P.crouch = 0.13 * (1 - t);
        this.kerry.root.position.y = baseY + Math.sin(t * Math.PI * 0.5) * 0.14;
        this.ballLocal.set(-0.06, lerp(0.96, 2.02, t), lerp(0.3, 0.18, t));
        handsOnBall();
      });
      // release
      const from = this.handBallPos();
      const r = (a) => rand(-a, a);
      const vel = solveShot(from, this.ballTarget(), 52 + r(3.5 + fatigue * 3));
      if (vel) {
        vel.multiplyScalar(1 + r(0.034 * (1 + fatigue)));
        vel.x += r(0.1 * (1 + fatigue)); vel.z += r(0.1 * (1 + fatigue));
        const spinAxis = new THREE.Vector3(vel.z, 0, -vel.x).normalize();
        B.release(vel, spinAxis.multiplyScalar(-14)); // backspin
      } else B.release(new THREE.Vector3(0, 2, 0));
      this.carryBall = false; this.ballLocal = null;
      shots++; this.shots++;
      const shotId = B.state.shotId;
      // follow-through, hold the pose, watch the ball
      yield* this.tween(0.35, (t) => {
        this.kerry.root.position.y = Math.max(0, 0.14 * Math.cos(t * Math.PI * 0.5));
        P.hands.r = this.localToWorld(-0.08, 2.0, 0.42); P.hands.l = this.localToWorld(0.16, 1.9, 0.3);
        P.hands.wl = 1 - t * 0.6; P.hands.wr = 1;
        P.handDirR = null;
      });
      this.kerry.root.position.y = 0;
      let watched = 0, made = false;
      while (watched < 1.6) {
        const dt = yield; watched += dt;
        P.look = B.state.pos.clone(); P.lookW = 1;
        P.hands.wr = Math.max(0, 1 - watched * 1.2); P.hands.wl = 0;
        if (B.state.scoredShot === shotId) made = true;
      }
      if (made) {
        this.makes++;
        if (B.state.rimHitShot !== shotId && Math.random() < 0.7) this.say(pick(['Cash.', 'Nothing but net.', 'Wet.']), 2);
        // small fist pump
        yield* this.tween(0.6, (t) => { const u = Math.sin(t * Math.PI); P.hands.r = this.localToWorld(-0.22, 1.25 + u * 0.12, 0.3); P.hands.wr = u; P.hands.poleR = this.localToWorld(-0.6, 0.4, -0.3); });
      } else {
        if (Math.random() < 0.5) this.say(pick(['Short.', 'Rim’s tight today.', 'Front iron.', 'Ugh.']), 2);
        yield* this.wait(0.4);
      }
      this.detail = `${this.makes}/${this.shots}`;
      P.hands.wr = P.hands.wl = 0;
    }
    this.handsBusy = false;
    if (this.carryBall) {
      // leave the ball near the hoop corner
      this.ballLocal = null;
      B.release(this.kerry.toWorld(new THREE.Vector3(0, 0, 1.2)).sub(this.kerry.root.position).setY(0.6));
      this.carryBall = false;
    }
    P.lookW = 0;
  }

  *board(instant) {
    const A = this.anchors.board, P = this.pose, wb = this.screens.board;
    const surf = this.props.whiteboard;
    const uvToWorld = (u, v) => surf.localToWorld(new THREE.Vector3((u - 0.5) * 1.5, (0.5 - v) * 1.0, 0.012));
    if (instant) this.setRoot(A.approach.clone(), A.facing);
    else yield* this.walkTo(A.approach.clone(), { facing: A.facing });
    if (wb.done()) {
      // wipe the board with the flat of the hand
      yield* this.tween(2.2, (t) => {
        const sweep = Math.sin(t * Math.PI * 4);
        P.hands.r = uvToWorld(0.5 + sweep * 0.35, 0.3 + t * 0.4).add(new THREE.Vector3(0.03, 0, 0)); P.hands.wr = Math.min(1, t * 6, (1 - t) * 6);
        P.look = uvToWorld(0.5, 0.5); P.lookW = 0.8;
        if (t > 0.5 && !this._erased) { wb.erase(); this._erased = true; }
      });
      this._erased = false;
    }
    let pen = { u: 0.1, v: 0.1 };
    const base = this.kerry.root.position.clone();
    while (!this.timeUp() && !wb.done()) {
      const dt = yield;
      const p = wb.write(dt, 0.22);
      if (p) pen = p;
      const tip = uvToWorld(pen.u, pen.v);
      // shuffle along the board to stay in reach
      const want = base.clone(); want.z = clamp(tip.z, -1.8, -0.6);
      this.kerry.root.position.z = damp(this.kerry.root.position.z, want.z + 0.1, 2, dt);
      P.hands.r = tip.clone().add(new THREE.Vector3(0.025, Math.sin(this.time * 22) * 0.004, 0)); P.hands.wr = 1;
      P.hands.poleR = this.localToWorld(-0.7, 0.5, -0.2);
      P.look = tip.clone(); P.lookW = 0.9;
    }
    P.hands.wr = 0;
    // step back and look at it
    yield* this.tween(0.8, (t) => { this.kerry.root.position.x = lerp(this.kerry.root.position.x, A.approach.x + 0.35, t * 0.2); });
    yield* this.wait(1.6, () => { P.look = uvToWorld(0.5, 0.45); P.lookW = 0.8; });
    if (Math.random() < 0.5) this.say(pick(['Yeah. That’s the plan.', 'Okay, that makes sense now.']), 2.5);
  }

  *rack(instant) {
    const A = this.anchors.rack, P = this.pose, rack = this.props.rack;
    if (instant) this.setRoot(A.approach.clone(), A.facing);
    else yield* this.walkTo(A.approach.clone(), { facing: A.facing });
    const oled = rack.oled.getWorldPosition(new THREE.Vector3());
    yield* this.tween(0.7, (t) => { P.crouch = 0.22 * t; P.lean = 0.35 * t; P.look = oled; P.lookW = t; });
    let reachT = 0;
    this.rackBusy = 1;
    while (!this.timeUp()) {
      const dt = yield;
      reachT += dt;
      const r = Math.sin(reachT * 0.9);
      if (r > 0.3) {
        P.hands.r = rack.group.localToWorld(new THREE.Vector3(-0.1 + Math.sin(reachT) * 0.08, 0.98, 0.26)); P.hands.wr = Math.min(1, (r - 0.3) * 4);
      } else P.hands.wr = damp(P.hands.wr, 0, 6, dt);
      P.look = oled; P.lookW = 0.9;
    }
    this.rackBusy = 0;
    P.hands.wr = 0;
    yield* this.tween(0.6, (t) => { P.crouch = 0.22 * (1 - t); P.lean = 0.35 * (1 - t); P.lookW = 1 - t; });
    if (Math.random() < 0.4) this.say('All green. Good.', 2);
  }

  // ============================================================== per-frame prop attachment (after IK)
  attachProps() {
    const ctrl = this.props.controller;
    if (this.held.controller === 'lap') this.placeInHands(ctrl, new THREE.Vector3(0, 0.64, 0.34), new THREE.Euler(-0.55, Math.PI, 0));
    else if (this.held.controller === 'carry') {
      const h = this.kerry.wp('righthand');
      ctrl.position.copy(h).add(new THREE.Vector3(0, -0.02, 0));
      ctrl.quaternion.copy(this.kerry.root.quaternion);
    }
    const G = this.props.guitar;
    if (this.held.guitar) this.placeInHands(G.group, this.held.guitar.pos, this.held.guitar.rot);
  }
}

function P_lookBall(brain) { brain.pose.look = brain.ball.state.pos.clone(); brain.pose.lookW = 0.8; }
