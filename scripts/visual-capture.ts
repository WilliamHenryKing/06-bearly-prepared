// Captures every camera bookmark from the production preview into docs/visual/captures/<set>/.
// Usage: bun run build && bun run preview & bun scripts/visual-capture.ts baseline
// Headless Chromium on SwiftShader; the renderer string is logged to renderer.txt.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

interface Hook {
  ready: boolean;
  bookmarks: string[];
  renderer: string;
  setBookmark(name: string): boolean;
  freeze(on?: boolean): void;
  settle(frames?: number): Promise<void>;
}
type Win = { __VISUAL_TEST__?: Hook };

const set = process.argv[2] ?? "baseline";
const only = process.argv[3];
const base = process.env.VISUAL_URL ?? "http://127.0.0.1:4616/?e2e";
const out = `docs/visual/captures/${set}`;
mkdirSync(out, { recursive: true });

const sizes: Record<string, { width: number; height: number; scale: number }> = {
  "hero-portrait": { width: 390, height: 844, scale: 2 },
};

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const probe = await browser.newPage();
await probe.goto(base);
await probe.waitForFunction(() => (window as Win).__VISUAL_TEST__?.ready === true, null, {
  timeout: 120_000,
});
const { bookmarks, renderer } = await probe.evaluate(() => {
  const h = (window as Win).__VISUAL_TEST__ as Hook;
  return { bookmarks: h.bookmarks, renderer: h.renderer };
});
await probe.close();
console.log(`renderer: ${renderer}`);
writeFileSync(`${out}/renderer.txt`, `${renderer}\n${new Date().toISOString()}\n`);

for (const name of bookmarks) {
  if (only && name !== only) continue;
  const size = sizes[name] ?? { width: 1440, height: 900, scale: 1 };
  const page = await browser.newPage({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.scale,
  });
  await page.goto(base);
  await page.waitForFunction(() => (window as Win).__VISUAL_TEST__?.ready === true, null, {
    timeout: 600_000,
  });
  page.setDefaultTimeout(600_000);
  await page.evaluate(async (n) => {
    const h = (window as Win).__VISUAL_TEST__ as Hook;
    h.setBookmark(n);
    await h.settle(4);
    h.freeze(true);
    await h.settle(6);
  }, name);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 600_000 });
  console.log(`captured ${name}`);
  await page.close();
}
await browser.close();
