import { expect, type Page, test } from "@playwright/test";
import { LOGS } from "../src/game/trail";

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
  await page.goto("/?e2e");
  await expect(page.locator("#arrival")).toHaveCount(0, { timeout: 30_000 });

  const kit = page.getByRole("list").first();
  await kit.getByRole("button", { name: /Biscuits/ }).click();
  await kit.getByRole("button", { name: /Blanket/ }).click();
  await page.getByRole("button", { name: "Move Blanket down" }).click();
  const stack = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: /^Move / }) });
  await expect(stack).toHaveText([/Teacups/, /Blanket/, /Kettle/]);

  await page.getByRole("button", { name: "Set off" }).click();
  await expect(page.getByRole("progressbar", { name: "Trail progress" })).toBeVisible();

  await page.keyboard.down("w");
  const jumped = new Set<number>();
  const deadline = Date.now() + 300_000;
  for (;;) {
    const h = await hike(page);
    if (h.phase !== "hiking" || Date.now() > deadline) break;
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

  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    /A neat cup of tea|A respectable picnic|An elaborate little lounge/,
  );
  await page.screenshot({ path: test.info().outputPath("tea.png") });
  await page.getByRole("button", { name: "Pack again" }).click();
  await expect(page.getByRole("button", { name: "Set off" })).toBeVisible();
});
