import { expect, type Page, test } from "@playwright/test";
import { LOGS } from "../src/game/trail";
import { readableGuide, ready, shot } from "./support";

// Packs kettle, blanket and teacups (heavy at the bottom), walks the whole trail holding W,
// jumping each log (Space) from a stride away as a player would, and checks that the tea scene
// appears and the game can be replayed. Collisions are real: a mistimed jump trips the bear
// back to the last flag, so the test also checks that it never tripped.

type Hike = { phase: string; d: number; speed: number; airborne: boolean; trips: number };
const hike = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __VISUAL_TEST__: { run(): Hike } }).__VISUAL_TEST__.run(),
  );

test("pack a sensible load and walk it to the lookout", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?e2e");
  await ready(page);

  const kit = page.getByRole("list").first();
  await kit.getByRole("button", { name: /Biscuits/ }).click();
  await kit.getByRole("button", { name: /Blanket/ }).click();
  await page.getByRole("button", { name: "Move Blanket down" }).click();
  const stack = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: /^Move / }) });
  await expect(stack).toHaveText([/Teacups/, /Blanket/, /Kettle/]);
  await shot(page, "packing");

  await page.getByRole("button", { name: "Set off" }).click();
  await expect(page.getByRole("progressbar", { name: "Trail progress" })).toBeVisible();

  await page.keyboard.down("w");
  await expect(page.getByRole("note")).toContainText("2 of 4", { timeout: 10_000 });
  await page.keyboard.up("w");
  // Use the visible load meter to counter-lean, just as the guide asks.
  for (let i = 0; i < 60; i++) {
    if (!(await page.getByRole("note").textContent())?.includes("2 of 4")) break;
    const label = await page.getByRole("img", { name: /^Load / }).getAttribute("aria-label");
    const key = label?.includes("left") ? "d" : "a";
    await page.keyboard.down(key);
    await page.waitForTimeout(100);
    await page.keyboard.up(key);
  }
  await expect(page.getByRole("note")).toContainText("3 of 4");
  await readableGuide(page);
  await shot(page, "guide-steady", 0);
  // The log instruction stays hidden until a log is within sight.
  await expect(page.getByRole("note")).toHaveCount(0, { timeout: 10_000 });
  await page.keyboard.down("w");
  const jumped = new Set<number>();
  const deadline = Date.now() + 300_000;
  let meadowShot = false;
  let pondShot = false;
  let logShot = false;
  for (;;) {
    const h = await hike(page);
    if (h.phase !== "hiking" || Date.now() > deadline) break;
    if (!meadowShot && h.d > 10) {
      meadowShot = true;
      await shot(page, "hike");
    }
    if (!pondShot && h.d > 34) {
      pondShot = true;
      await shot(page, "pond");
    }
    if (!logShot && h.d > 39) {
      logShot = true;
      await expect(page.getByRole("note")).toContainText("4 of 4");
      await readableGuide(page);
      await shot(page, "guide-log");
    }
    // Take off when the log is about 0.3 s of walking ahead.
    const log = LOGS.find(
      (l) => !jumped.has(l.at) && l.at - h.d > 0 && l.at - h.d < 0.25 + h.speed * 0.12,
    );
    if (log && !h.airborne) {
      jumped.add(log.at);
      await page.keyboard.down("Space");
      await page.waitForTimeout(60);
      await page.keyboard.up("Space");
    }
    await page.waitForTimeout(25);
  }
  await expect(page.getByText("At the lookout")).toBeVisible({ timeout: 30_000 });
  await page.keyboard.up("w");
  expect((await hike(page)).trips).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem("bearly-prepared:hinted"))).toBe("1");

  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    /A neat cup of tea|A respectable picnic|An elaborate little lounge/,
  );
  await shot(page, "tea");
  const card = page.getByRole("dialog");
  await expect(card).toBeFocused();
  expect(await card.evaluate((el) => el.scrollTop)).toBe(0);
  await page.keyboard.press("Tab");
  await expect(card.getByRole("button", { name: /^Sound / })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Pack again" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(card.getByRole("button", { name: /^Sound / })).toBeFocused();
  for (const [width, height] of [
    [390, 844],
    [568, 320],
    [320, 568],
  ] as const) {
    await page.setViewportSize({ width, height });
    await card.evaluate((el) => {
      el.focus();
      el.scrollTop = 0;
    });
    await expect(card.getByRole("heading", { level: 2 })).toBeVisible();
    await shot(page, `tea-${width}`);
  }
  await page.getByRole("button", { name: "Pack again" }).click();
  await expect(page.getByRole("button", { name: "Set off" })).toBeVisible();
  expect((await hike(page)).d).toBe(0);
  await page.waitForTimeout(1800);
  expect((await hike(page)).phase).toBe("packing");
  await expect(page.locator(".pack-panel")).toBeFocused();
  expect(errors).toEqual([]);
});
