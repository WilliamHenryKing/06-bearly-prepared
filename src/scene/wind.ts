import * as THREE from "three";
import type { SceneResources } from "./resources";

// Visible wind on the ledge: pale streaks race across the path. A few thin ones come with the
// whistle that warns of a gust, then a dense rush while it pushes, so gusts are seen coming.

interface Streak {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  speed: number;
}

export class WindStreaks {
  readonly group = new THREE.Group();
  private pool: Streak[] = [];
  private mat = new THREE.MeshBasicMaterial({
    color: 0x6a6e70,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private geo = new THREE.PlaneGeometry(1.6, 0.06);
  private spawn = 0;

  clear() {
    this.spawn = 0;
    for (const streak of this.pool) streak.mesh.visible = false;
  }

  dispose(resources: SceneResources) {
    this.clear();
    resources.tree(this.group);
    resources.release(this.mat);
    resources.release(this.geo);
  }

  /**
   * @param center bear position; @param right unit vector to the walker's right
   * @param dir -1/1 side the wind pushes toward; @param rate streaks per second
   */
  update(dt: number, center: THREE.Vector3, right: THREE.Vector3, dir: number, rate: number) {
    this.spawn += rate * dt;
    while (this.spawn >= 1) {
      this.spawn -= 1;
      this.emit(center, right, dir);
    }
    for (const s of this.pool) {
      if (!s.mesh.visible) continue;
      s.age += dt;
      const t = s.age / s.life;
      if (t >= 1) {
        s.mesh.visible = false;
        continue;
      }
      s.mesh.position.addScaledVector(s.mesh.userData.v as THREE.Vector3, dt * s.speed);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.sin(t * Math.PI) * 0.8;
    }
  }

  private emit(center: THREE.Vector3, right: THREE.Vector3, dir: number) {
    let s = this.pool.find((x) => !x.mesh.visible);
    if (!s) {
      if (this.pool.length > 60) return;
      const mesh = new THREE.Mesh(this.geo, this.mat.clone());
      this.group.add(mesh);
      s = { mesh, age: 0, life: 1, speed: 1 };
      this.pool.push(s);
    }
    const v = right.clone().multiplyScalar(dir);
    const fwd = new THREE.Vector3(right.z, 0, -right.x);
    s.mesh.position
      .copy(center)
      .addScaledVector(v, -5 - Math.random() * 2)
      .addScaledVector(fwd, (Math.random() - 0.3) * 7)
      .setY(center.y + 0.3 + Math.random() * 2.6);
    s.mesh.rotation.set(0, Math.atan2(-v.z, v.x), 0);
    s.mesh.userData.v = v;
    s.age = 0;
    s.life = 0.9 + Math.random() * 0.5;
    s.speed = 9 + Math.random() * 4;
    s.mesh.visible = true;
  }
}
