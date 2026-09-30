import * as THREE from "three";
import { LEDGE, LOGS, type PathPoint, pointAt, TRAIL_LENGTH } from "../game/trail";
import { felt, matte, PALETTE, paintedWood } from "./materials";

// Each obstacle is its own place: a signposted hairpin with chevron boards on the outside of
// the bend, a log crossing, and a cliff ledge with a rope fence and a windsock that shows
// where the next gust is coming from. Signs face the walker as they approach.

function signTexture(text: string, bg: string, arrow: "left" | "right" | "none" = "none") {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 96;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 96);
    g.strokeStyle = "#f6eedb";
    g.lineWidth = 4;
    g.setLineDash([8, 6]);
    g.strokeRect(8, 8, 240, 80);
    g.fillStyle = "#f6eedb";
    g.font = "800 34px ui-rounded, system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const x = arrow === "none" ? 128 : 148;
    g.fillText(text, x, 50);
    if (arrow !== "none") {
      g.beginPath();
      const s = arrow === "left" ? -1 : 1;
      g.moveTo(44 + s * 18, 48);
      g.lineTo(44 - s * 8, 30);
      g.lineTo(44 - s * 8, 66);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function chevronTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#f6eedb";
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = "#c84b3c";
    for (const x of [18, 58, 98]) {
      g.beginPath();
      g.moveTo(x, 32);
      g.lineTo(x + 22, 6);
      g.lineTo(x + 34, 6);
      g.lineTo(x + 12, 32);
      g.lineTo(x + 34, 58);
      g.lineTo(x + 22, 58);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const post = paintedWood(0x6d4a2c);

function place(path: readonly PathPoint[], d: number, side: number, obj: THREE.Object3D) {
  const p = pointAt(path, d);
  obj.position.set(p.x + Math.cos(p.heading) * side, p.y, p.z - Math.sin(p.heading) * side);
  obj.rotation.y = p.heading;
  return obj;
}

function sign(text: string, bg: string, arrow: "left" | "right" | "none" = "none") {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), post);
  stick.position.y = 0.7;
  stick.castShadow = true;
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.34, 0.05), [
    post,
    post,
    post,
    post,
    new THREE.MeshStandardMaterial({ map: signTexture(text, bg, arrow), roughness: 0.7 }),
    post,
  ]);
  board.position.set(0, 1.3, 0.05);
  board.castShadow = true;
  g.add(stick, board);
  return g;
}

export class Landmarks {
  readonly group = new THREE.Group();
  private sock: THREE.Group;

  constructor(path: readonly PathPoint[]) {
    const g = this.group;
    g.add(place(path, 12.5, 1.35, sign("Hairpin", "#9e3529", "left")));
    g.add(place(path, (LOGS[0]?.at ?? 47) - 5, 1.35, sign("Log steps", "#6d4a2c")));
    g.add(place(path, LEDGE.from - 3.5, 1.35, sign("Windy ledge", "#2f6f8a")));
    g.add(place(path, TRAIL_LENGTH - 7, 1.35, sign("Lookout", "#4f7a58")));

    // Chevron boards around the outside of the hairpin.
    const chev = new THREE.MeshStandardMaterial({ map: chevronTexture(), roughness: 0.6 });
    for (let d = 16.5; d < 28; d += 2.2) {
      const b = new THREE.Group();
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 0.06), post);
      leg.position.y = 0.27;
      const face = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.04), [
        post,
        post,
        post,
        post,
        chev,
        post,
      ]);
      face.position.y = 0.62;
      face.castShadow = true;
      b.add(leg, face);
      g.add(place(path, d, 1.6, b));
    }

    // Rope fence along the drop side of the ledge.
    const rope = felt(0xd9c08a, 0.3);
    const pts: THREE.Vector3[] = [];
    for (let d = LEDGE.from + 1; d <= LEDGE.to - 1; d += 2.6) {
      const p = place(path, d, -1.05, new THREE.Group());
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.7, 8), post);
      stake.position.copy(p.position).setY(p.position.y + 0.35);
      stake.castShadow = true;
      g.add(stake);
      pts.push(p.position.clone().setY(p.position.y + 0.62));
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as THREE.Vector3;
      const b = pts[i] as THREE.Vector3;
      const mid = a
        .clone()
        .lerp(b, 0.5)
        .setY((a.y + b.y) / 2 - 0.12);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.012, 5), rope));
    }

    // Windsock at the start of the ledge.
    const mast = place(path, LEDGE.from + 0.5, -1.5, new THREE.Group());
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 2.2, 8),
      matte(0xe8e0cc, 0.5),
    );
    pole.position.y = 1.1;
    pole.castShadow = true;
    mast.add(pole);
    this.sock = new THREE.Group();
    this.sock.position.y = 2.1;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13 - i * 0.022, 0.13 - (i + 1) * 0.022, 0.2, 12, 1, true),
        felt(i % 2 ? 0xf1ece0 : PALETTE.enamelRed, 0.3),
      );
      (seg.material as THREE.Material).side = THREE.DoubleSide;
      seg.rotation.z = Math.PI / 2;
      seg.position.x = 0.1 + i * 0.2;
      seg.castShadow = true;
      this.sock.add(seg);
    }
    mast.add(this.sock);
    g.add(mast);
  }

  /** What moves once built (kept out of the static batch). */
  get moving(): THREE.Object3D[] {
    return [this.sock];
  }

  /** Point the windsock with the wind; `wind` is signed strength toward the walker's right. */
  update(wind: number, time: number, calm: boolean) {
    const target = wind >= 0 ? 0 : Math.PI;
    this.sock.rotation.y += (target - this.sock.rotation.y) * 0.05;
    const droop = 1 - Math.min(1, Math.abs(wind) * 2.5 + 0.2);
    this.sock.rotation.z = -droop * 1.1 + (calm ? 0 : Math.sin(time * 9) * 0.05 * Math.abs(wind));
  }
}
