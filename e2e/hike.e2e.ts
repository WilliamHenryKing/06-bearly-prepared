import { expect, test } from "@playwright/test";

// Packs kettle, blanket and teacups (heavy at the bottom), walks the whole trail holding W and
// checks that the tea scene appears and the game can be replayed.

test("pack a sensible load and walk it to the lookout", async ({ page }) => {
  await page.goto("/");
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
  await page.getByRole("button", { name: "Off we go" }).click();
  await expect(page.getByRole("progressbar", { name: "Trail progress" })).toBeVisible();

  await page.keyboard.down("w");
  await expect(page.getByText("At the lookout")).toBeVisible({ timeout: 300_000 });
  await page.keyboard.up("w");

  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    /A neat cup of tea|A respectable picnic|An elaborate little lounge/,
  );
  await page.screenshot({ path: test.info().outputPath("tea.png") });
  await page.getByRole("button", { name: "Pack again" }).click();
  await expect(page.getByRole("button", { name: "Set off" })).toBeVisible();
});
