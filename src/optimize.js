import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Picking proxies: one invisible box per clickable thing, so hover and click
// never have to raycast thousands of triangles (or a skinned mesh).
export function buildProxies(hotspots, scene) {
  const proxies = [];
  const mat = new THREE.MeshBasicMaterial({ visible: false });
  for (const [id, objs] of Object.entries(hotspots)) {
    for (const o of objs) {
      o.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(o);
      if (box.isEmpty()) continue;
      const size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.09, 0.09, 0.09));
      const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
      box.getCenter(m.position);
      m.userData.hotspot = id;
      m.userData.follow = isDynamic(o) ? o : null;
      m.userData.offset = m.position.clone().sub(o.getWorldPosition(new THREE.Vector3()));
      scene.add(m);
      proxies.push(m);
    }
  }
  return proxies;
}

function isDynamic(o) {
  for (let p = o; p; p = p.parent) if (p.userData && p.userData.dynamic) return true;
  return false;
}

// Merge every static, opaque mesh that shares a material into one draw call.
// The room goes from several hundred draw calls to a few dozen.
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const byMat = new Map();
  const count = new Map();
  root.traverse((o) => { if (o.isMesh && !Array.isArray(o.material)) count.set(o.material, (count.get(o.material) || 0) + 1); });
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible) return;
    if (Array.isArray(o.material) || o.material.transparent || isDynamic(o)) return;
    if ((count.get(o.material) || 0) < 2) return;
    const key = o.material.uuid + (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : '');
    if (!byMat.has(key)) byMat.set(key, { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, list: [] });
    byMat.get(key).list.push(o);
  });
  let removed = 0, created = 0;
  for (const { mat, cast, recv, list } of byMat.values()) {
    if (list.length < 2) continue;
    const geos = [];
    for (const m of list) {
      let g = m.geometry.clone();
      if (g.index) g = g.toNonIndexed();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.clearGroups();
      g.applyMatrix4(m.matrixWorld);
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mm = new THREE.Mesh(merged, mat);
    mm.castShadow = cast; mm.receiveShadow = recv;
    mm.matrixAutoUpdate = false;
    root.add(mm);
    created++;
    for (const m of list) { m.parent.remove(m); removed++; }
  }
  // nothing left in the room moves on its own except flagged props
  root.traverse((o) => { if (!isDynamic(o) && o !== root) { o.updateMatrix(); o.matrixAutoUpdate = false; } });
  return { removed, created };
}

// Cheaper materials for phones: drop sheen/clearcoat lobes, keep maps.
export function simplifyMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (m.isMeshPhysicalMaterial) { m.sheen = 0; m.clearcoat = 0; m.needsUpdate = true; }
    });
  });
}
