import type { Input } from "../game/run";

export type InputKey = "walk" | "left" | "right" | "jump";
type Owner = string | number;
const CODES: Record<string, InputKey> = {
  KeyW: "walk",
  ArrowUp: "walk",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "jump",
};

/** Each physical key and held button owns its contribution until that source releases. */
export function createInputTracker() {
  const keys = new Set<string>();
  const pendingKeys = new Set<string>();
  const pendingTouches = new Set<Owner>();
  const touches: Record<InputKey, Set<Owner>> = {
    walk: new Set(),
    left: new Set(),
    right: new Set(),
    jump: new Set(),
  };
  const held = (key: InputKey) =>
    [...keys].some((code) => CODES[code] === key) || touches[key].size > 0;
  return {
    keyDown(code: string, repeat = false) {
      if (!CODES[code] || (repeat && !keys.has(code))) return false;
      if (CODES[code] === "jump" && !keys.has(code)) pendingKeys.add(code);
      keys.add(code);
      return true;
    },
    keyUp(code: string) {
      keys.delete(code);
    },
    touch(key: InputKey, down: boolean, owner: Owner = "legacy") {
      if (down) {
        if (key === "jump" && !touches[key].has(owner)) pendingTouches.add(owner);
        touches[key].add(owner);
      } else touches[key].delete(owner);
    },
    cancelTouch(key: InputKey, owner: Owner = "legacy") {
      touches[key].delete(owner);
      if (key === "jump") pendingTouches.delete(owner);
    },
    read(consumeJump = true): Input {
      const jump = held("jump") || pendingKeys.size > 0 || pendingTouches.size > 0;
      if (consumeJump) {
        pendingKeys.clear();
        pendingTouches.clear();
      }
      return {
        walk: held("walk"),
        lean: Number(held("right")) - Number(held("left")),
        jump,
      };
    },
    clear() {
      keys.clear();
      pendingKeys.clear();
      pendingTouches.clear();
      for (const owners of Object.values(touches)) owners.clear();
    },
  };
}

const tracker = createInputTracker();
const resets = new Set<() => void>();

const element = (target: EventTarget | null) =>
  typeof HTMLElement !== "undefined" && target instanceof HTMLElement ? target : null;

export function isEditingTarget(target: EventTarget | null): boolean {
  const el = element(target);
  return (
    !!el &&
    (el.isContentEditable ||
      !!el.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])"))
  );
}

export function bindKeyboard(active: () => boolean) {
  const down = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || isEditingTarget(e.target))
      return;
    const el = element(e.target);
    const control = el?.closest("button,a,input,select,textarea");
    const nativeActivation = e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter";
    if (control && nativeActivation) {
      if (e.repeat) e.preventDefault();
      return;
    }
    if (!active() || document.hidden) return;
    if (
      e.code.startsWith("Arrow") &&
      (el?.closest(".keyboard-scroll") || (control && !control.hasAttribute("data-game-key")))
    )
      return;
    if (e.code === "Space" && el?.closest(".keyboard-scroll")) return;
    if (tracker.keyDown(e.code, e.repeat)) e.preventDefault();
  };
  const up = (e: KeyboardEvent) => tracker.keyUp(e.code);
  const hidden = () => {
    if (document.hidden) releaseAll();
  };
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", hidden);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", releaseAll);
    document.removeEventListener("visibilitychange", hidden);
    releaseAll();
  };
}

export const setTouch = (key: InputKey, down: boolean, owner?: Owner) =>
  tracker.touch(key, down, owner);
export const cancelTouch = (key: InputKey, owner?: Owner) => tracker.cancelTouch(key, owner);
/** Peek while no fixed step is due, so a quick tap survives until it can be simulated. */
export const readInput = (consumeJump = true) => tracker.read(consumeJump);
export function onInputReset(listener: () => void) {
  resets.add(listener);
  return () => {
    resets.delete(listener);
  };
}
export function releaseAll() {
  tracker.clear();
  for (const reset of resets) reset();
}
