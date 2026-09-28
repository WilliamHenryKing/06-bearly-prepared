import type { Input } from "../game/run";

// Keyboard and on-screen buttons feed one input state. Keys: W / ↑ walk, Space jumps,
// A / ← and D / → lean. On-screen buttons set the same flags while pressed.

const held = { walk: false, left: false, right: false, jump: false };
const touch = { walk: false, left: false, right: false, jump: false };

const WALK = new Set(["KeyW", "ArrowUp"]);
const JUMP = new Set(["Space"]);
const LEFT = new Set(["KeyA", "ArrowLeft"]);
const RIGHT = new Set(["KeyD", "ArrowRight"]);

function setKey(code: string, down: boolean, target: EventTarget | null) {
  // Let Space and arrows keep their meaning on focused buttons and inputs.
  const el = target as HTMLElement | null;
  const onControl =
    !!el && /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(el.tagName) && !el.dataset.gameKey;
  if (onControl && down && (code === "Space" || code.startsWith("Arrow"))) return false;
  if (WALK.has(code)) held.walk = down;
  else if (JUMP.has(code)) held.jump = down;
  else if (LEFT.has(code)) held.left = down;
  else if (RIGHT.has(code)) held.right = down;
  else return false;
  return true;
}

export function bindKeyboard(active: () => boolean) {
  const down = (e: KeyboardEvent) => {
    if (!active()) return;
    if (setKey(e.code, true, e.target)) e.preventDefault();
  };
  const up = (e: KeyboardEvent) => {
    setKey(e.code, false, null);
  };
  const blur = () => releaseAll();
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", blur);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", blur);
  };
}

export function setTouch(key: keyof typeof touch, down: boolean) {
  touch[key] = down;
}

export function readInput(): Input {
  const left = held.left || touch.left;
  const right = held.right || touch.right;
  return {
    walk: held.walk || touch.walk,
    lean: (right ? 1 : 0) - (left ? 1 : 0),
    jump: held.jump || touch.jump,
  };
}

export function releaseAll() {
  held.walk = held.left = held.right = held.jump = false;
  touch.walk = touch.left = touch.right = touch.jump = false;
}
