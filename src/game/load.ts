import { type ItemId, item } from "./items";

// The stack sits on a backpack whose top is PACK_TOP metres above the bear's hip pivot.
export const PACK_MASS = 1;
export const PACK_CENTER = 0.3;
export const PACK_TOP = 0.5;
export const BLANKET_GRIP_BONUS = 0.1;

export interface StackEntry {
  id: ItemId;
  bottom: number;
  center: number;
  height: number;
}

export interface LoadStats {
  mass: number;
  comHeight: number;
  inertia: number;
  height: number;
  maxSpeed: number;
  /** 0 calm … 1 wildly top-heavy; a readable summary for the packing panel. */
  wobble: number;
}

export function layoutStack(ids: readonly ItemId[]): StackEntry[] {
  let y = PACK_TOP;
  return ids.map((id) => {
    const h = item(id).height;
    const entry = { id, bottom: y, center: y + h / 2, height: h };
    y += h;
    return entry;
  });
}

export function loadStats(ids: readonly ItemId[]): LoadStats {
  const stack = layoutStack(ids);
  let mass = PACK_MASS;
  let moment = PACK_MASS * PACK_CENTER;
  let inertia = 0.4 + PACK_MASS * PACK_CENTER * PACK_CENTER;
  for (const e of stack) {
    const w = item(e.id).weight;
    mass += w;
    moment += w * e.center;
    inertia += w * e.center * e.center;
  }
  const comHeight = moment / mass;
  const top = stack.length ? (stack[stack.length - 1] as StackEntry) : null;
  const height = top ? top.bottom + top.height - PACK_TOP : 0;
  const carried = mass - PACK_MASS;
  const maxSpeed = Math.max(1.2, 2 - 0.06 * carried);
  const wobble = Math.min(1, Math.max(0, (mass * comHeight - 2) / 11));
  return { mass, comHeight, inertia, height, maxSpeed, wobble };
}

/** Grip of the item at `index`, improved when it rests directly on the blanket. */
export function effectiveGrip(ids: readonly ItemId[], index: number): number {
  const id = ids[index];
  if (!id) return 0;
  const below = index > 0 ? ids[index - 1] : undefined;
  return item(id).grip + (below === "blanket" ? BLANKET_GRIP_BONUS : 0);
}
