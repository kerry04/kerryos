import * as THREE from 'three';

// Occupancy grid over the floor built from furniture footprints, inflated by
// Kerry's radius. A* with 8-way moves, then string-pulled into a short list of
// waypoints so he walks in straight lines and turns at corners like a person.

export function buildNav(colliders, bounds, { cell = 0.08, radius = 0.24 } = {}) {
  const minX = bounds.minX + 0.05, minZ = bounds.minZ + 0.05;
  const W = Math.ceil((bounds.maxX - 0.05 - minX) / cell), Hh = Math.ceil((bounds.maxZ - 0.05 - minZ) / cell);
  const grid = new Uint8Array(W * Hh);
  const toCell = (x, z) => [Math.floor((x - minX) / cell), Math.floor((z - minZ) / cell)];
  const toWorld = (i, j) => new THREE.Vector3(minX + (i + 0.5) * cell, 0, minZ + (j + 0.5) * cell);
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
    const p = toWorld(i, j);
    if (p.x < bounds.minX + radius || p.z < bounds.minZ + radius || p.x > bounds.maxX - 0.2 || p.z > bounds.maxZ - 0.2) { grid[j * W + i] = 1; continue; }
    for (const c of colliders) {
      if (!c.nav || c.min.y > 0.3) continue;
      if (p.x > c.min.x - radius && p.x < c.max.x + radius && p.z > c.min.z - radius && p.z < c.max.z + radius) { grid[j * W + i] = 1; break; }
    }
  }
  const blocked = (i, j) => i < 0 || j < 0 || i >= W || j >= Hh || grid[j * W + i] === 1;

  function nearestFree(i, j) {
    if (!blocked(i, j)) return [i, j];
    for (let r = 1; r < 30; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (!blocked(i + di, j + dj)) return [i + di, j + dj];
    }
    return [i, j];
  }

  function lineFree(a, b) {
    const d = a.distanceTo(b), n = Math.ceil(d / (cell * 0.5));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const [i, j] = toCell(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      if (blocked(i, j)) return false;
    }
    return true;
  }

  function path(from, to) {
    let [si, sj] = nearestFree(...toCell(from.x, from.z));
    let [ti, tj] = nearestFree(...toCell(to.x, to.z));
    const start = sj * W + si, goal = tj * W + ti;
    const g = new Float32Array(W * Hh).fill(Infinity);
    const came = new Int32Array(W * Hh).fill(-1);
    const open = [[0, start]];
    g[start] = 0;
    const hfn = (k) => { const i = k % W, j = (k / W) | 0; const dx = Math.abs(i - ti), dz = Math.abs(j - tj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    const closed = new Uint8Array(W * Hh);
    let found = false, iter = 0;
    while (open.length && iter++ < 20000) {
      // small binary-heap-free pop (open list stays short on this grid)
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
      const [, cur] = open.splice(bi, 1)[0];
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const ci = cur % W, cj = (cur / W) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (blocked(ni, nj)) continue;
        if (di && dj && (blocked(ci + di, cj) || blocked(ci, cj + dj))) continue;
        const nk = nj * W + ni;
        const ng = g[cur] + (di && dj ? 1.414 : 1);
        if (ng < g[nk]) { g[nk] = ng; came[nk] = cur; open.push([ng + hfn(nk), nk]); }
      }
    }
    const pts = [];
    if (found) {
      let k = goal;
      while (k !== -1) { pts.push(toWorld(k % W, (k / W) | 0)); k = came[k]; }
      pts.reverse();
    } else pts.push(toWorld(si, sj), toWorld(ti, tj));
    // string pulling
    const out = [from.clone().setY(0)];
    let anchor = out[0];
    for (let k = 1; k < pts.length; k++) {
      if (!lineFree(anchor, pts[k])) { anchor = pts[k - 1]; out.push(anchor); }
    }
    const end = to.clone().setY(0);
    out.push(lineFree(anchor, end) ? end : pts[pts.length - 1]);
    return out;
  }

  function isFree(p) { return !blocked(...toCell(p.x, p.z)); }
  function randomFree(region) {
    for (let k = 0; k < 200; k++) {
      const x = region.minX + Math.random() * (region.maxX - region.minX);
      const z = region.minZ + Math.random() * (region.maxZ - region.minZ);
      const p = new THREE.Vector3(x, 0, z);
      if (isFree(p)) return p;
    }
    return new THREE.Vector3(0.6, 0, 0.6);
  }
  return { path, isFree, randomFree, lineFree };
}
