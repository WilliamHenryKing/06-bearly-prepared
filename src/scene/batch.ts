import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Draw-call batching for the set dressing. Parts that never move once built are baked, world
// transform and all, into one mesh per material (and shadow setting) for each 40 m stretch of
// the walk, so a village of several hundred parts costs a few dozen draws in each pass (scene,
// ambient occlusion and shadow) instead of several hundred, and each stretch is still culled on
// its own. Parts under `moving` (animated, recoloured or looked up later) are left as they are.
// A material that rewrites the vertex shader (the leaves' sway bends by local height) is never
// baked: meshes sharing its geometry become one instanced mesh instead, which the shader already
// handles. Transparent materials keep their own meshes, so blending still sorts back to front.

const CELL = 40;
/** Instanced meshes are baked only while small (the orchard's apples, not the meadow's grass). */
const MAX_BAKED_INSTANCE_VERTICES = 20000;

interface Batch {
  material: THREE.Material;
  cast: boolean;
  receive: boolean;
  parts: THREE.BufferGeometry[];
}

interface Instances {
  mesh: THREE.Mesh;
  matrices: THREE.Matrix4[];
  sources: THREE.Mesh[];
}

/** The triangles `start … start + count` of the index (or of the vertices), compacted. */
function subset(geometry: THREE.BufferGeometry, start: number, count: number) {
  const index = geometry.index;
  const remap = new Map<number, number>();
  const order: number[] = [];
  const triangles: number[] = [];
  for (let i = start; i < start + count; i++) {
    const v = index ? index.getX(i) : i;
    let n = remap.get(v);
    if (n === undefined) {
      n = order.length;
      remap.set(v, n);
      order.push(v);
    }
    triangles.push(n);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, source] of Object.entries(geometry.attributes)) {
    const size = source.itemSize;
    const Typed = source.array.constructor as new (length: number) => THREE.TypedArray;
    const copy = new THREE.BufferAttribute(new Typed(order.length * size), size, source.normalized);
    order.forEach((v, k) => {
      for (let c = 0; c < size; c++) copy.setComponent(k, c, source.getComponent(v, c));
    });
    out.setAttribute(name, copy);
  }
  out.setIndex(triangles);
  return out;
}

/** One geometry per material the mesh draws with, each moved into the batch's space. */
function pieces(mesh: THREE.Mesh, matrix: THREE.Matrix4) {
  const g = mesh.geometry;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const total = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
  const from = Math.max(0, g.drawRange.start);
  const to = Math.min(total, g.drawRange.start + g.drawRange.count);
  const ranges =
    Array.isArray(mesh.material) && g.groups.length
      ? g.groups.map((r) => ({
          material: materials[r.materialIndex ?? 0],
          start: Math.max(from, r.start),
          end: Math.min(to, r.start + r.count),
        }))
      : [{ material: materials[0], start: from, end: to }];
  const flip = matrix.determinant() < 0;
  const out: { material: THREE.Material; geometry: THREE.BufferGeometry }[] = [];
  for (const r of ranges) {
    if (!r.material || r.end <= r.start) continue;
    const piece = subset(g, r.start, r.end - r.start);
    piece.applyMatrix4(matrix);
    // A mirroring transform turns the triangles inside out; wind them back.
    if (flip) {
      const index = piece.index as THREE.BufferAttribute;
      for (let i = 0; i + 2 < index.count; i += 3) {
        const b = index.getX(i + 1);
        index.setX(i + 1, index.getX(i + 2));
        index.setX(i + 2, b);
      }
    }
    out.push({ material: r.material, geometry: piece });
  }
  return out;
}

const customShader = (m: THREE.Material) => Object.hasOwn(m, "onBeforeCompile");

function cellOf(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingSphere();
  const c = (geometry.boundingSphere as THREE.Sphere).center;
  return `${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`;
}

function signature(geometry: THREE.BufferGeometry) {
  return Object.entries(geometry.attributes)
    .map(([name, a]) => `${name}:${a.itemSize}:${a.array.constructor.name}:${a.normalized}`)
    .sort()
    .join(";");
}

/**
 * Batch every static mesh under `root` (see above). Call once the dressing is placed and
 * before its first frame. Returns how many draws it saved per pass.
 */
export function batchStatic(root: THREE.Object3D, moving: Iterable<THREE.Object3D> = []) {
  const skip = new Set(moving);
  root.updateWorldMatrix(true, true);
  const toRoot = root.matrixWorld.clone().invert();
  const batches = new Map<string, Batch>();
  const instances = new Map<string, Instances>();
  const baked: THREE.Mesh[] = [];
  let before = 0;

  const visit = (o: THREE.Object3D) => {
    if (skip.has(o) || !o.visible) return;
    for (const child of o.children) visit(child);
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o === root) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const geometry = mesh.geometry;
    const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? (mesh as THREE.InstancedMesh)
      : null;
    if (
      (mesh as THREE.SkinnedMesh).isSkinnedMesh ||
      mesh.morphTargetInfluences ||
      Object.keys(geometry.morphAttributes).length ||
      Object.hasOwn(mesh, "onBeforeRender") ||
      mesh.layers.mask !== 1 ||
      !geometry.attributes.position ||
      materials.some((m) => m.transparent || !m.visible) ||
      instanced?.instanceColor
    )
      return;
    const matrix = new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);
    if (materials.some(customShader)) {
      // Shader-driven: gather meshes that share geometry and material into instances.
      if (instanced || materials.length > 1) return;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      const at = (geometry.boundingSphere as THREE.Sphere).center.clone().applyMatrix4(matrix);
      const key = [
        geometry.uuid,
        materials[0]?.uuid,
        mesh.castShadow,
        mesh.receiveShadow,
        `${Math.floor(at.x / CELL)},${Math.floor(at.z / CELL)}`,
      ].join("|");
      let set = instances.get(key);
      if (!set) {
        set = { mesh, matrices: [], sources: [] };
        instances.set(key, set);
      }
      set.matrices.push(matrix);
      set.sources.push(mesh);
      return;
    }
    const copies = instanced ? instanced.count : 1;
    if (instanced && copies * geometry.attributes.position.count > MAX_BAKED_INSTANCE_VERTICES)
      return;
    const each = new THREE.Matrix4();
    for (let i = 0; i < copies; i++) {
      if (instanced) instanced.getMatrixAt(i, each);
      const m = instanced ? matrix.clone().multiply(each) : matrix;
      for (const { material, geometry: piece } of pieces(mesh, m)) {
        const key = [
          material.uuid,
          mesh.castShadow,
          mesh.receiveShadow,
          cellOf(piece),
          signature(piece),
        ].join("|");
        let batch = batches.get(key);
        if (!batch) {
          batch = { material, cast: mesh.castShadow, receive: mesh.receiveShadow, parts: [] };
          batches.set(key, batch);
        }
        batch.parts.push(piece);
      }
    }
    before += Array.isArray(mesh.material) ? Math.max(1, geometry.groups.length) : 1;
    baked.push(mesh);
  };
  visit(root);

  const added: THREE.Object3D[] = [];
  for (const batch of batches.values()) {
    const geometry = mergeGeometries(batch.parts, false);
    for (const p of batch.parts) p.dispose();
    if (!geometry) throw new Error("batchStatic: parts do not merge");
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, batch.material);
    mesh.castShadow = batch.cast;
    mesh.receiveShadow = batch.receive;
    mesh.name = "batch";
    added.push(mesh);
  }
  for (const set of instances.values()) {
    if (set.matrices.length < 2) continue;
    const { mesh: first } = set;
    const mesh = new THREE.InstancedMesh(
      first.geometry,
      first.material as THREE.Material,
      set.matrices.length,
    );
    set.matrices.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.name = "batch";
    before += set.sources.length;
    baked.push(...set.sources);
    added.push(mesh);
  }
  for (const mesh of baked) {
    let parent = mesh.parent;
    mesh.removeFromParent();
    // Drop the groups left empty.
    while (parent && parent !== root && parent.children.length === 0 && !skip.has(parent)) {
      const up: THREE.Object3D | null = parent.parent;
      parent.removeFromParent();
      parent = up;
    }
  }
  if (added.length) root.add(...added);
  return before - added.length;
}
