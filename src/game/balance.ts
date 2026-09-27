import type { LoadStats } from "./load";

// Sideways balance of the load about the bear's hips. Positive tilt leans to the bear's right.
// The load is an inverted pendulum held upright by the bear's grip (stiffness) and damped by
// its springy shoulders. Leaning shifts the hips and pushes the load the way the player leans.

export const GRAVITY = 9.8;
export const GRIP_BASE = 34;
export const GRIP_PER_KG = 8;
export const DAMPING = 0.85;
export const LEAN_SHIFT = 0.24;
export const LEAN_RATE = 7;

export interface BalanceState {
  tilt: number;
  spin: number;
  lean: number;
}

export interface Forces {
  /** Desired lean, -1 (left) … 1 (right). */
  lean: number;
  /** Sideways acceleration felt by the load, m/s², positive to the right. */
  lateral: number;
  /** Direct torque on the load (gusts, footsteps). */
  torque: number;
}

export const restingBalance = (): BalanceState => ({ tilt: 0, spin: 0, lean: 0 });

export function stiffness(stats: LoadStats): number {
  return GRIP_BASE + GRIP_PER_KG * stats.mass;
}

export function stepBalance(
  s: BalanceState,
  stats: LoadStats,
  f: Forces,
  dt: number,
): BalanceState {
  const lean = s.lean + (clamp(f.lean, -1, 1) - s.lean) * Math.min(1, LEAN_RATE * dt);
  const k = stiffness(stats);
  const c = DAMPING * 2 * Math.sqrt(k * stats.inertia) * 0.35;
  const gravity = GRAVITY * stats.mass * stats.comHeight * Math.sin(s.tilt);
  const torque =
    gravity -
    k * s.tilt -
    c * s.spin +
    stats.mass * stats.comHeight * f.lateral +
    f.torque +
    lean * stats.mass * GRAVITY * LEAN_SHIFT;
  const spin = s.spin + (torque / stats.inertia) * dt;
  return { tilt: s.tilt + spin * dt, spin, lean };
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
