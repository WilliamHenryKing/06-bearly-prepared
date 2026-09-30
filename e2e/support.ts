import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

const evidence = path.resolve("../../.workspace/bug-pass-2026-09-30/06");
export async function shot(page: Page, name: string, settleMs = 500) {
  mkdirSync(evidence, { recursive: true });
  if (settleMs) await page.waitForTimeout(settleMs);
  await page.screenshot({ path: path.join(evidence, `${name}.png`) });
}

export async function ready(page: Page) {
  await expect(page.locator("#arrival")).toHaveCount(0, { timeout: 90_000 });
  if (process.env.REQUIRE_REAL_GPU === "1") {
    const renderer = await page.evaluate(
      () =>
        (window as unknown as { __VISUAL_TEST__: { renderer: string } }).__VISUAL_TEST__.renderer,
    );
    expect(renderer).toMatch(/NVIDIA|RTX/i);
    expect(renderer).not.toMatch(/SwiftShader|llvmpipe/i);
  }
}

export async function readRun(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as {
        __VISUAL_TEST__: {
          run(): {
            phase: string;
            d: number;
            speed: number;
            airborne: boolean;
            trips: number;
          };
        };
      }
    ).__VISUAL_TEST__.run(),
  );
}

export async function readableGuide(page: Page) {
  const note = page.getByRole("note");
  await expect(note).toBeVisible();
  // Visibility alone passes clipped text. Check that the instruction is actually unobscured.
  const clear = await note.evaluate((el) => {
    const paragraphs = [...el.querySelectorAll("p")].slice(0, 2);
    return (
      paragraphs.length === 2 &&
      paragraphs.every((p, i) => {
        const r = p.getBoundingClientRect();
        const x = r.left + Math.min(24, r.width / 2);
        const y = i === 0 ? r.bottom - 6 : r.top + Math.min(10, r.height / 2);
        return y > 0 && y < innerHeight && !!el.contains(document.elementFromPoint(x, y));
      })
    );
  });
  expect(clear).toBe(true);
}
