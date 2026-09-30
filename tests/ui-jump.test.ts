import { describe, expect, test } from "bun:test";
import { createRun, startHike, stepRun } from "../src/game/run";
import { createInputTracker } from "../src/ui/input";

describe("jump edges at the simulation boundary", () => {
  test("a complete pointer tap between frames is delivered once", () => {
    const input = createInputTracker();
    input.touch("jump", true, "Jump:pointer");
    input.touch("jump", false, "Jump:pointer");
    expect(input.read().jump).toBe(true);
    expect(input.read().jump).toBe(false);
  });

  test("a complete physical key press is delivered once", () => {
    const input = createInputTracker();
    input.keyDown("Space");
    input.keyUp("Space");
    expect(input.read().jump).toBe(true);
    expect(input.read().jump).toBe(false);
  });

  test("non-simulation reads keep a quick tap until an actual fixed step", () => {
    const input = createInputTracker();
    const run = createRun();
    startHike(run);
    input.touch("jump", true, 1);
    input.touch("jump", false, 1);
    for (let i = 0; i < 4; i++) expect(input.read(false).jump).toBe(true);
    expect(run.airborne).toBe(false);
    stepRun(run, input.read(true), 1 / 120);
    expect(run.airborne).toBe(true);
    expect(input.read().jump).toBe(false);
  });

  test("held input and operating-system repeats do not become queued second jumps", () => {
    const input = createInputTracker();
    input.keyDown("Space");
    expect(input.read().jump).toBe(true);
    input.keyDown("Space", true);
    expect(input.read().jump).toBe(true);
    input.keyUp("Space");
    expect(input.read().jump).toBe(false);
    input.touch("jump", true, "pointer");
    expect(input.read().jump).toBe(true);
    input.touch("jump", true, "pointer");
    input.touch("jump", false, "pointer");
    expect(input.read().jump).toBe(false);
  });

  test("canceling one source preserves another source's quick tap", () => {
    const input = createInputTracker();
    input.touch("jump", true, "pointer");
    input.touch("jump", true, "native-key");
    input.touch("jump", false, "pointer");
    input.touch("jump", false, "native-key");
    input.cancelTouch("jump", "pointer");
    expect(input.read().jump).toBe(true);
    expect(input.read().jump).toBe(false);
  });

  test("canceling a pointer cannot release the independent held physical key", () => {
    const input = createInputTracker();
    input.keyDown("Space");
    input.touch("jump", true, 1);
    input.cancelTouch("jump", 1);
    expect(input.read().jump).toBe(true);
    input.keyUp("Space");
    expect(input.read().jump).toBe(false);
  });

  test("cancel, unmount and phase reset can discard unconsumed activation", () => {
    const input = createInputTracker();
    input.touch("jump", true, "pointer");
    input.touch("jump", false, "pointer");
    input.cancelTouch("jump", "pointer");
    expect(input.read().jump).toBe(false);
    input.touch("jump", true, "pointer");
    input.touch("jump", false, "pointer");
    input.keyDown("Space");
    input.keyUp("Space");
    input.clear();
    expect(input.read(false)).toEqual({ walk: false, lean: 0, jump: false });
    expect(input.keyDown("Space", true)).toBe(false);
  });

  test("a tap during recovery is consumed there rather than jumping after recovery", () => {
    const input = createInputTracker();
    const run = createRun();
    startHike(run);
    run.busy = 0.25;
    input.touch("jump", true, "pointer");
    input.touch("jump", false, "pointer");
    for (let i = 0; i < 60; i++) stepRun(run, input.read(true), 1 / 120);
    expect(run.busy).toBe(0);
    expect(run.airborne).toBe(false);
  });
});
