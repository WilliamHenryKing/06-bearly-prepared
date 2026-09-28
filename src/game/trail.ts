// One authored trail: meadow → hairpin → the pond → log steps → the village green (a crowd glued
// to its phones) → the orchard (low branches) → the goose's lane → windy ledge → lookout.
// Everything is a function of distance along the path, so rules and scene agree exactly.

export const TRAIL_LENGTH = 216;

export type Zone =
  | "meadow"
  | "hairpin"
  | "logs"
  | "green"
  | "orchard"
  | "lane"
  | "ledge"
  | "lookout";

interface Span {
  from: number;
  to: number;
  curvature: number;
  zone: Zone;
}

const SPANS: Span[] = [
  { from: 0, to: 16, curvature: 0.015, zone: "meadow" },
  { from: 16, to: 28, curvature: 0.26, zone: "hairpin" },
  { from: 28, to: 42, curvature: 0, zone: "meadow" },
  { from: 42, to: 64, curvature: -0.02, zone: "logs" },
  { from: 64, to: 72, curvature: -0.12, zone: "meadow" },
  { from: 72, to: 106, curvature: 0.012, zone: "green" },
  { from: 106, to: 134, curvature: -0.035, zone: "orchard" },
  { from: 134, to: 151, curvature: 0.075, zone: "lane" },
  { from: 151, to: 168, curvature: -0.075, zone: "lane" },
  { from: 168, to: 176, curvature: -0.05, zone: "meadow" },
  { from: 176, to: 202, curvature: 0.02, zone: "ledge" },
  { from: 202, to: TRAIL_LENGTH + 20, curvature: 0.05, zone: "lookout" },
];

export const CHECKPOINTS = [0, 14, 40, 70, 104, 132, 170];

/** Logs across the path. `lurch` is the side the load is thrown when stepping over at speed. */
export const LOGS = [
  { at: 47, lurch: 1 },
  { at: 51.5, lurch: -1 },
  { at: 55.5, lurch: -1 },
  { at: 60, lurch: 1 },
];

/** A log's top above the path, and half its width along the path (with a boot's allowance). */
export const LOG_TOP = 0.24;
export const LOG_HALF = 0.2;

/**
 * Cross-slope of the path in radians, positive where the ground falls away to the walker's
 * right. The trail crosses the flank of the first hill (falling right) and the goose lane's
 * cambered bend (falling left); gravity pushes the load downhill there.
 */
export function camberAt(d: number): number {
  return (
    0.24 * (smooth(3, 6, d) - smooth(12.5, 15.5, d)) -
    0.17 * (smooth(150, 153, d) - smooth(162, 165, d))
  );
}

export const GREEN = { from: 72, to: 106 };
export const ORCHARD = { from: 106, to: 134 };
export const LANE = { from: 134, to: 168 };
export const LEDGE = { from: 176, to: 202 };

const span = (d: number): Span =>
  SPANS.find((s) => d >= s.from && d < s.to) ?? (SPANS[SPANS.length - 1] as Span);

export const curvatureAt = (d: number) => span(d).curvature;
export const zoneAt = (d: number): Zone => span(d).zone;

/** The tilt beyond which the bear topples. The ledge is narrower and less forgiving. */
export const toppleLimit = (d: number) => (zoneAt(d) === "ledge" ? 0.78 : 0.95);

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function elevationAt(d: number): number {
  return (
    1.6 * smooth(16, 30, d) +
    1.4 * smooth(32, 66, d) +
    1.1 * smooth(108, 134, d) +
    0.6 * smooth(136, 166, d) +
    0.8 * smooth(176, 202, d) +
    1 * smooth(202, 214, d)
  );
}

export function lastCheckpoint(d: number): number {
  let best = 0;
  for (const c of CHECKPOINTS) if (d >= c) best = c;
  return best;
}

// Gusts on the ledge follow a fixed rhythm: a whistle, a push, a lull.
export const GUST_PERIOD = 4.2;
export const GUST_PATTERN = [1, 1, -1, 1, -1, -1];
const WARN = 1.2;
const RAMP = 0.4;
const HOLD = 1.3;
const FADE = 0.5;

export interface Gust {
  /** Side the wind pushes toward, -1 left / 1 right. */
  dir: number;
  /** 0 … 1 strength now. */
  strength: number;
  /** True while the whistle telegraphs the next push. */
  warning: boolean;
}

export function gustAt(clock: number): Gust {
  const n = Math.floor(clock / GUST_PERIOD);
  const p = clock - n * GUST_PERIOD;
  const dir = GUST_PATTERN[n % GUST_PATTERN.length] ?? 1;
  if (p < WARN) return { dir, strength: 0, warning: true };
  const q = p - WARN;
  let strength = 0;
  if (q < RAMP) strength = q / RAMP;
  else if (q < RAMP + HOLD) strength = 1;
  else if (q < RAMP + HOLD + FADE) strength = 1 - (q - RAMP - HOLD) / FADE;
  return { dir, strength, warning: false };
}

export interface PathPoint {
  d: number;
  x: number;
  y: number;
  z: number;
  heading: number;
}

/** Integrates curvature into a path in the XZ plane. Heading 0 walks toward -Z. */
export function samplePath(step = 0.5, extra = 14): PathPoint[] {
  const pts: PathPoint[] = [];
  let x = 0;
  let z = 0;
  let heading = 0;
  for (let d = 0; d <= TRAIL_LENGTH + extra + 1e-6; d += step) {
    pts.push({ d, x, y: elevationAt(d), z, heading });
    heading += curvatureAt(d) * step;
    x -= Math.sin(heading) * step;
    z -= Math.cos(heading) * step;
  }
  return pts;
}

export function pointAt(path: readonly PathPoint[], d: number): PathPoint {
  const step = (path[1]?.d ?? 1) - (path[0]?.d ?? 0);
  const i = Math.max(0, Math.min(path.length - 2, Math.floor(d / step)));
  const a = path[i] as PathPoint;
  const b = path[i + 1] as PathPoint;
  const t = Math.max(0, Math.min(1, (d - a.d) / step));
  return {
    d,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    heading: a.heading + (b.heading - a.heading) * t,
  };
}
