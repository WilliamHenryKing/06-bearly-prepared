// Films the game itself, stepping time deterministically through the ?e2e hook (docs/visual):
// start from a camera bookmark's trail position, hand back to the follow camera, hold keys, and
// save every frame; then a GIF and a strip of frames for review.
//
//   node tools/batch/game-film.mjs <out-dir> <bookmark> <seconds> [fps=30] [keys=KeyW] [hold]
//   ("hold" keeps the bookmark's fixed camera instead of the follow camera)
//   FILM_PLAN=jumptrip: walk, jump the first log cleanly and trip on the second;
//   FILM_PLAN=goose: stand still while the goose charges in, then walk on.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const { chromium } = await import(
  "file:///C:/Users/William King/AppData/Local/npm-cache/_npx/81fb41e6b6793dc6/node_modules/playwright/index.mjs"
);
const MAGICK = "C:/Users/William King/.codex/tools/visual/ImageMagick-7.1.2-31/magick.exe";
const [out, bookmark, seconds, fpsArg, keysArg, hold] = process.argv.slice(2);
const base = process.env.FILM_URL ?? "http://127.0.0.1:4516";
const fps = Number(fpsArg ?? 30);
const keys = (keysArg ?? "KeyW").split(",").filter(Boolean);
const frames = Math.round(Number(seconds) * fps);
mkdirSync(`${out}/frames`, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${base}/?e2e`);
await page.waitForFunction(() => window.__VISUAL_TEST__?.ready === true, null, { timeout: 120000 });
await page.addStyleTag({ content: "#arrival{display:none!important}" });
await page.evaluate(
  async ([b, keep]) => {
    const h = window.__VISUAL_TEST__;
    h.setBookmark(b);
    if (!keep) h.clearBookmark();
    h.freeze(true);
    await h.settle(3);
  },
  [bookmark, hold === "hold"],
);
await page
  .locator("canvas#stage")
  .click({ position: { x: 5, y: 5 }, force: true })
  .catch(() => {});
const plan = process.env.FILM_PLAN ?? "";
const LOG_JUMP = 47;
let walking = plan !== "goose";
if (walking) for (const k of keys) await page.keyboard.down(k);
let jumped = false;
for (let i = 0; i < frames; i++) {
  if (plan === "jumptrip" && !jumped) {
    const r = await page.evaluate(() => window.__VISUAL_TEST__.run());
    if (LOG_JUMP - r.d > 0 && LOG_JUMP - r.d < 0.25 + r.speed * 0.12 && !r.airborne) {
      jumped = true;
      await page.keyboard.down("Space");
      await page.evaluate((dt) => window.__VISUAL_TEST__.step(dt), 1 / fps);
      await page.keyboard.up("Space");
    }
  }
  if (plan === "goose" && !walking && i >= fps * 6.5) {
    walking = true;
    for (const k of ["KeyW"]) await page.keyboard.down(k);
  }
  await page.evaluate((dt) => window.__VISUAL_TEST__.step(dt), 1 / fps);
  await page.screenshot({ path: `${out}/frames/f_${String(i).padStart(4, "0")}.png` });
}
for (const k of keys) await page.keyboard.up(k);
await browser.close();
execFileSync(MAGICK, [
  "-delay",
  String(Math.round(100 / fps)),
  "-loop",
  "0",
  `${out}/frames/f_*.png`,
  "-resize",
  "640x",
  "-layers",
  "Optimize",
  `${out}/film.gif`,
]);
const picks = Array.from(
  { length: 8 },
  (_, i) => `${out}/frames/f_${String(Math.round((i * (frames - 1)) / 7)).padStart(4, "0")}.png`,
);
execFileSync(MAGICK, [
  "montage",
  ...picks,
  "-tile",
  "4x",
  "-geometry",
  "480x+2+2",
  "-background",
  "#111",
  `${out}/strip.jpg`,
]);
console.log(
  `${frames} frames, ${errors.length} page errors${errors.length ? `: ${errors[0]}` : ""}`,
);
