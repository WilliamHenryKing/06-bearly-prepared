// Unattended look-dev batch (docs/STUDIO-PIPELINE.md, D14): renders a job file's shots through
// lookdev.html on the real GPU, with a thermal guard, then builds contact sheets and films.
//
//   node tools/batch/lookdev.mjs <job.json> <out-dir> [base-url=http://127.0.0.1:4516]
//
// Job: { "viewport": [w, h], "base": {params}, "shots": [{ "name", "params" }],
//        "films": [{ "name", "params", "frames", "fps" }],
//        "sheets": [{ "name", "shots": ["name", …], "cols": 4 }] }
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const { chromium } = await import(
  "file:///C:/Users/William King/AppData/Local/npm-cache/_npx/81fb41e6b6793dc6/node_modules/playwright/index.mjs"
);
const MAGICK = "C:/Users/William King/.codex/tools/visual/ImageMagick-7.1.2-31/magick.exe";
const [jobPath, outDir, base = "http://127.0.0.1:4516"] = process.argv.slice(2);
const job = JSON.parse(readFileSync(jobPath, "utf8"));
mkdirSync(outDir, { recursive: true });
const log = [];
const note = (line) => {
  const stamp = new Date().toISOString().slice(11, 19);
  log.push(`${stamp} ${line}`);
  console.log(`${stamp} ${line}`);
};

// Pause at 82 °C and resume at 76 °C (the studio kit's guard).
const temperature = () => {
  try {
    return Number(
      execFileSync("nvidia-smi", ["--query-gpu=temperature.gpu", "--format=csv,noheader"])
        .toString()
        .trim(),
    );
  } catch {
    return 0;
  }
};
async function guard() {
  let t = temperature();
  if (t < 82) return;
  note(`gpu ${t} °C: pausing`);
  while (t > 76) {
    await new Promise((r) => setTimeout(r, 15000));
    t = temperature();
  }
  note(`gpu ${t} °C: resuming`);
}

const [w, h] = job.viewport ?? [1200, 1200];
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await (
  await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
).newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));
const query = new URLSearchParams(job.base ?? {}).toString();
await page.goto(`${base}/lookdev.html?${query}`);
await page.waitForFunction(() => window.__LOOKDEV__?.ready, null, { timeout: 120000 });
const info = await page.evaluate(() => window.__LOOKDEV__.info());
note(`ready on ${info.gpu} (three r${info.three})`);

const set = (params) => page.evaluate((p) => window.__LOOKDEV__.set(p), params);
const settle = (n) => page.evaluate((k) => window.__LOOKDEV__.settle(k), n);
const t0 = Date.now();
for (const shot of job.shots ?? []) {
  await guard();
  await set({ ...(job.base ?? {}), ...shot.params });
  await settle(shot.settle ?? 10);
  await page.screenshot({ path: `${outDir}/${shot.name}.png` });
  note(`shot ${shot.name}`);
}
for (const film of job.films ?? []) {
  await guard();
  await set({ ...(job.base ?? {}), ...film.params });
  await settle(6);
  const dir = `${outDir}/${film.name}`;
  mkdirSync(dir, { recursive: true });
  const fps = film.fps ?? 30;
  for (let i = 0; i < film.frames; i++) {
    await page.evaluate((dt) => window.__LOOKDEV__.step(dt), 1 / fps);
    await settle(2);
    await page.screenshot({ path: `${dir}/f_${String(i).padStart(4, "0")}.png` });
  }
  execFileSync(MAGICK, [
    "-delay",
    String(Math.round(100 / fps)),
    "-loop",
    "0",
    `${dir}/f_*.png`,
    "-resize",
    `${film.width ?? 600}x`,
    "-layers",
    "Optimize",
    `${outDir}/${film.name}.gif`,
  ]);
  if (film.strip) {
    // Every k-th frame side by side: the poses of one cycle, for judging the motion.
    const k = Math.max(1, Math.round(film.frames / film.strip));
    const picks = Array.from(
      { length: film.strip },
      (_, i) => `${dir}/f_${String(i * k).padStart(4, "0")}.png`,
    );
    execFileSync(MAGICK, [
      "montage",
      ...picks,
      "-tile",
      `${film.strip}x1`,
      "-geometry",
      `${film.stripWidth ?? 300}x+2+2`,
      "-background",
      "#111",
      `${outDir}/${film.name}-strip.jpg`,
    ]);
  }
  note(`film ${film.name} (${film.frames} frames)`);
}
for (const sheet of job.sheets ?? []) {
  execFileSync(MAGICK, [
    "montage",
    ...sheet.shots.map((s) => `${outDir}/${s}.png`),
    "-tile",
    `${sheet.cols ?? 4}x`,
    "-geometry",
    `${sheet.width ?? 480}x+3+3`,
    "-background",
    "#111",
    "-fill",
    "#ddd",
    "-font",
    "Consolas",
    "-pointsize",
    "14",
    "-title",
    sheet.name,
    `${outDir}/sheet-${sheet.name}.jpg`,
  ]);
  note(`sheet ${sheet.name}`);
}
await browser.close();
const summary = {
  job: jobPath,
  gpu: info.gpu,
  three: info.three,
  seconds: Math.round((Date.now() - t0) / 1000),
  errors,
};
writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
writeFileSync(`${outDir}/log.txt`, `${log.join("\n")}\n`);
note(`done in ${summary.seconds} s, ${errors.length} console errors`);
