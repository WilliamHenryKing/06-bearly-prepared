import { describe, expect, test } from "bun:test";
import {
  bindKeyboard,
  createInputTracker,
  isEditingTarget,
  onInputReset,
  readInput,
  releaseAll,
  setTouch,
} from "../src/ui/input";

describe("independent input ownership", () => {
  test("releasing one walk or lean alias leaves the other physical key held", () => {
    const input = createInputTracker();
    input.keyDown("KeyW");
    input.keyDown("ArrowUp");
    input.keyUp("KeyW");
    expect(input.read().walk).toBe(true);
    input.keyUp("ArrowUp");
    expect(input.read().walk).toBe(false);
    input.keyDown("KeyA");
    input.keyDown("ArrowLeft");
    input.keyUp("KeyA");
    expect(input.read().lean).toBe(-1);
    input.keyUp("ArrowLeft");
    expect(input.read().lean).toBe(0);
  });
  test("pointer and native keyboard holds on one button do not cancel each other", () => {
    const input = createInputTracker();
    input.touch("walk", true, "pointer:1");
    input.touch("walk", true, "key:Space");
    input.touch("walk", false, "pointer:2");
    expect(input.read().walk).toBe(true);
    input.touch("walk", false, "pointer:1");
    expect(input.read().walk).toBe(true);
    input.touch("walk", false, "key:Space");
    expect(input.read().walk).toBe(false);
  });
  test("two touch controls combine and opposite leans cancel without cancelling Walk", () => {
    const input = createInputTracker();
    input.touch("walk", true, 1);
    input.touch("left", true, 2);
    expect(input.read()).toEqual({ walk: true, lean: -1, jump: false });
    input.touch("right", true, 3);
    expect(input.read().lean).toBe(0);
    input.touch("left", false, 2);
    expect(input.read().lean).toBe(1);
    expect(input.read().walk).toBe(true);
  });
  test("clearing requires a fresh press rather than an operating-system repeat", () => {
    const input = createInputTracker();
    input.keyDown("KeyW");
    input.touch("jump", true, 1);
    input.clear();
    expect(input.read()).toEqual({ walk: false, lean: 0, jump: false });
    expect(input.keyDown("KeyW", true)).toBe(false);
    expect(input.read().walk).toBe(false);
    expect(input.keyDown("KeyW")).toBe(true);
  });
});

class Target extends EventTarget {
  constructor(
    public kind = "div",
    public scroll = false,
    public gameKey = false,
    public isContentEditable = false,
  ) {
    super();
  }
  closest(selector: string): Target | null {
    if (selector === ".keyboard-scroll") return this.scroll ? this : null;
    if (selector.includes("contenteditable") && this.isContentEditable) return this;
    return selector.split(",").includes(this.kind) ? this : null;
  }
  hasAttribute(name: string) {
    return name === "data-game-key" && this.gameKey;
  }
}
interface Harness {
  press: (
    code: string,
    target?: Target,
    options?: {
      repeat?: boolean;
      ctrlKey?: boolean;
      altKey?: boolean;
      metaKey?: boolean;
      prevented?: boolean;
    },
  ) => Event;
  up: (code: string) => void;
  active: (value: boolean) => void;
  blur: () => void;
  visibility: (hidden: boolean) => void;
  unbind: () => void;
}
/** Exercise the actual event adapter without creating a browser or renderer. */
function keyboard(check: (harness: Harness) => void) {
  const originals = ["window", "document", "HTMLElement"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const windowEvents = new EventTarget();
  const documentEvents = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowEvents });
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentEvents });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: Target });
  let active = true;
  releaseAll();
  const unbind = bindKeyboard(() => active);
  try {
    check({
      press(code, target = new Target(), options = {}) {
        const event = new Event("keydown", { cancelable: true });
        Object.assign(event, {
          code,
          repeat: false,
          ctrlKey: false,
          altKey: false,
          metaKey: false,
          ...options,
        });
        Object.defineProperty(event, "target", { value: target });
        if (options.prevented) event.preventDefault();
        windowEvents.dispatchEvent(event);
        return event;
      },
      up(code) {
        windowEvents.dispatchEvent(Object.assign(new Event("keyup"), { code }));
      },
      active(value) {
        active = value;
      },
      blur() {
        windowEvents.dispatchEvent(new Event("blur"));
      },
      visibility(hidden) {
        documentEvents.hidden = hidden;
        documentEvents.dispatchEvent(new Event("visibilitychange"));
      },
      unbind,
    });
  } finally {
    unbind();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

describe("native keyboard behavior and cancellation", () => {
  test("Space on focused Walk belongs only to the button, and a neutral group can jump", () =>
    keyboard(({ press, up }) => {
      setTouch("walk", true, "Walk:Space");
      press("Space", new Target("button", false, true), { prevented: true });
      expect(readInput()).toEqual({ walk: true, lean: 0, jump: false });
      setTouch("walk", false, "Walk:Space");
      press("Space");
      expect(readInput().jump).toBe(true);
      up("Space");
      expect(readInput().jump).toBe(false);
    }));
  test("text, modifiers and already-handled keys never start walking or leaning", () =>
    keyboard(({ press }) => {
      for (const target of [
        new Target("input"),
        new Target("textarea"),
        new Target("select"),
        new Target("div", false, false, true),
      ]) {
        expect(isEditingTarget(target)).toBe(true);
        press("KeyW", target);
        press("KeyA", target);
      }
      for (const options of [
        { ctrlKey: true },
        { altKey: true },
        { metaKey: true },
        { prevented: true },
      ])
        press("KeyW", new Target(), options);
      expect(readInput()).toEqual({ walk: false, lean: 0, jump: false });
    }));
  test("reading arrows and Space keep scrolling, while letter controls remain deliberate", () =>
    keyboard(({ press }) => {
      const reading = new Target("div", true);
      expect(press("ArrowUp", reading).defaultPrevented).toBe(false);
      expect(press("ArrowLeft", reading).defaultPrevented).toBe(false);
      expect(press("Space", reading).defaultPrevented).toBe(false);
      expect(readInput()).toEqual({ walk: false, lean: 0, jump: false });
      expect(press("KeyW", reading).defaultPrevented).toBe(true);
      expect(readInput().walk).toBe(true);
    }));
  test("holding Enter on a pack button cannot repeatedly toggle it even outside hiking", () =>
    keyboard(({ press, active }) => {
      active(false);
      expect(press("Enter", new Target("button"), { repeat: true }).defaultPrevented).toBe(true);
      expect(press("Space", new Target("button"), { repeat: true }).defaultPrevented).toBe(true);
      press("KeyW");
      expect(readInput().walk).toBe(false);
    }));
  test("blur, visibility and unbinding clear every source and notify held-button visuals", () =>
    keyboard(({ press, blur, visibility, unbind }) => {
      let resets = 0;
      const stop = onInputReset(() => resets++);
      try {
        press("KeyW");
        setTouch("left", true, 2);
        blur();
        expect(readInput()).toEqual({ walk: false, lean: 0, jump: false });
        expect(resets).toBe(1);
        press("KeyW", new Target(), { repeat: true });
        expect(readInput().walk).toBe(false);
        press("KeyW");
        visibility(true);
        expect(readInput().walk).toBe(false);
        visibility(false);
        press("KeyD");
        expect(readInput().lean).toBe(1);
        unbind();
        expect(readInput().lean).toBe(0);
        press("KeyW");
        expect(readInput().walk).toBe(false);
      } finally {
        stop();
      }
    }));
});
