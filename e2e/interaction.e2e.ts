import { expect, test } from "@playwright/test";
import { readableGuide, readRun, ready, shot } from "./support";

const failures = new WeakMap<object, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(({ page }) => {
  expect(failures.get(page)).toEqual([]);
});

test("independent held keys, native Walk activation and action-led practice", async ({ page }) => {
  await page.goto("/?e2e");
  await ready(page);
  await page.getByRole("button", { name: "Set off" }).click();
  await readableGuide(page);
  await page.keyboard.down("w");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(500);
  await page.keyboard.up("w");
  const before = (await readRun(page)).d;
  await page.waitForTimeout(600);
  expect((await readRun(page)).d).toBeGreaterThan(before + 0.3);
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^Walk, hold/ }).focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(160);
  expect((await readRun(page)).airborne).toBe(false);
  await page.keyboard.up("Space");
  await page.waitForTimeout(500);
  expect((await readRun(page)).speed).toBe(0);
  // Replaying help never starts a new hike; idle time never claims a control was learned.
  const distance = (await readRun(page)).d;
  await page.getByRole("button", { name: "How to play: replay the guide" }).click();
  await page.waitForTimeout(1200);
  expect((await readRun(page)).d).toBeCloseTo(distance, 1);
  await expect(page.getByRole("note")).toContainText("1 of 4");
  await readableGuide(page);
  await expect(page.locator(".hike-controls")).toBeFocused();
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(500);
  await page.keyboard.up("ArrowUp");
  expect((await readRun(page)).d).toBeGreaterThan(distance + 0.1);
  await page.getByRole("button", { name: "Skip the guide" }).click();
  await expect(page.getByRole("note")).toHaveCount(0);
  await shot(page, "controls");
});

for (const [width, height] of [
  [390, 844],
  [568, 320],
  [320, 568],
] as const) {
  test(`touch guide and packing at ${width}x${height}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:4616/?e2e");
    await ready(page);
    await shot(page, `packing-${width}`);
    await page.getByRole("button", { name: "Set off" }).tap();
    await readableGuide(page);
    await shot(page, `guide-${width}`);
    const walk = page.getByRole("button", { name: /^Walk, hold/ });
    const box = await walk.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("Missing Walk control");
    expect(box.height).toBeGreaterThanOrEqual(44);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
    await page.waitForTimeout(3000);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await page.waitForTimeout(550);
    expect((await readRun(page)).d).toBeGreaterThan(1);
    expect((await readRun(page)).speed).toBe(0);
    await readableGuide(page);
    await shot(page, `guide-lean-${width}`);
    await page.getByRole("button", { name: "Jump (Space)", exact: true }).tap();
    await expect.poll(async () => (await readRun(page)).airborne, { timeout: 1500 }).toBe(true);
    await expect.poll(async () => (await readRun(page)).airborne, { timeout: 3000 }).toBe(false);
    await page.getByRole("button", { name: "Skip the guide" }).tap();
    await page.getByRole("button", { name: "How to play: replay the guide" }).tap();
    await readableGuide(page);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("live reduced motion finishes the title glide and retains packing", async ({ page }) => {
  await page.goto("/?e2e&intro");
  await ready(page);
  await page.getByRole("button", { name: "Begin", exact: true }).click();
  await page.waitForTimeout(150);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: "Set off" })).toBeVisible({ timeout: 1500 });
  await shot(page, "live-motion");
  await page.reload();
  await ready(page);
  await page.getByRole("button", { name: "Begin", exact: true }).click();
  await expect(page.getByRole("button", { name: "Set off" })).toBeVisible({ timeout: 1000 });
});

test("the laptop guide leaves all four controls unobstructed", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto("/?e2e");
  await ready(page);
  await page.getByRole("button", { name: "Set off" }).click();
  await readableGuide(page);
  const controls = page.locator(".hold-control");
  expect(await controls.count()).toBe(4);
  for (const button of await controls.all()) {
    expect(
      await button.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }),
    ).toBe(true);
  }
  await shot(page, "guide-laptop");
});

test("all six packed items remain visible in the compact portrait guide", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/?e2e");
  await ready(page);
  const kit = page.getByRole("list").first();
  for (const name of [/Blanket/, /Folding chair/, /Standard lamp/]) {
    await kit.getByRole("button", { name }).click();
  }
  await page.getByRole("button", { name: "Set off" }).click();
  await readableGuide(page);
  await shot(page, "guide-tall-320");
});

test("a missing critical texture keeps an honest recoverable loader", async ({ page }) => {
  await page.route("**/textures/*/*_diff.webp", (route) => route.abort());
  await page.goto("/?e2e");
  await expect(page.locator("#arrival")).toContainText("The valley could not load", {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Reload", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload", exact: true })).toBeFocused();
  await expect(page.locator("#arrival")).not.toHaveClass(/is-done/);
  await shot(page, "startup-recovery");
});

test("a render failure at tea closes the modal before offering Reload", async ({ page }) => {
  await page.goto("/?e2e");
  await ready(page);
  await page.getByRole("button", { name: "Set off" }).click();
  // Use the existing capture bookmark only to isolate failure recovery at the ending.
  // The separate full-hike scenario verifies normal progression to this dialog.
  await page.evaluate(() => {
    const api = (
      window as unknown as {
        __VISUAL_TEST__: { setBookmark(name: string): boolean; clearBookmark(): void };
      }
    ).__VISUAL_TEST__;
    api.setBookmark("lookout");
    api.clearBookmark();
  });
  await page.keyboard.down("w");
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 25_000 });
  await page.keyboard.up("w");
  await page.evaluate(() => {
    const gl = document.querySelector<HTMLCanvasElement>("#stage")?.getContext("webgl2");
    if (!gl) throw new Error("No game WebGL context");
    const draw = gl.drawElements;
    gl.drawElements = (...args) => {
      gl.drawElements = draw;
      throw new Error(`Injected draw failure (${args[1]} indices)`);
    };
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const reload = page.getByRole("button", { name: "Reload", exact: true });
  await expect(reload).toBeFocused();
  await reload.click({ trial: true });
  await expect(page.locator("#arrival")).toContainText("The valley could not load");
  await shot(page, "tea-recovery");
});
