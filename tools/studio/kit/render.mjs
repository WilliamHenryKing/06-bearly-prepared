// Studio renderer: serves the turntable page from the project (its own three.js), then renders
// every studio model on the real GPU — 8 beauty views at 2× (downsampled), 48-frame turntable
// films for hero families, 12-angle silhouette atlases where asked — and builds contact sheets.
// Resumable; pauses when the GPU passes 82 °C until it cools to 76 °C.
// Usage (project root): node tools/studio/kit/render.mjs --port 47NN [--only fam,fam] [--limit n]
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const opt = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const port = Number(opt("--port", "4799"));
const only = opt("--only")?.split(",");
const limit = Number(opt("--limit", "100000"));
const size = Number(opt("--size", "1024"));
const tools = {
  playwright:
    process.env.STUDIO_PLAYWRIGHT ??
    "C:/Users/William King/AppData/Local/npm-cache/_npx/81fb41e6b6793dc6/node_modules/playwright/index.mjs",
  magick: process.env.STUDIO_MAGICK ?? "C:/Users/William King/.codex/tools/visual/ImageMagick-7.1.2-31/magick.exe",
  ffmpeg:
    process.env.STUDIO_FFMPEG ??
    "C:/Users/William King/.bun/install/cache/@remotion/compositor-win32-x64-msvc@4.0.500@@@1/ffmpeg.exe",
};
const studio = path.resolve("assets-src/studio");
const docs = path.resolve("docs/visual/studio");
mkdirSync(docs, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
const temperature = () => {
  try {
    return Number(execFileSync("nvidia-smi", ["--query-gpu=temperature.gpu", "--format=csv,noheader"]).toString().trim());
  } catch {
    return 0;
  }
};
const cool = async () => {
  if (temperature() < 82) return;
  log("GPU at 82 C: cooling");
  while (temperature() > 76) await sleep(20_000);
};
const save = (dataUrl, file, target, quality = 86) => {
  const raw = `${file}.raw.png`;
  writeFileSync(raw, Buffer.from(dataUrl.split(",")[1], "base64"));
  execFileSync(tools.magick, [raw, "-filter", "Lanczos", "-resize", `${target}x${target}`, "-quality", String(quality), file]);
  rmSync(raw);
};

const index = JSON.parse(readFileSync(path.join(studio, "index.json"), "utf8"));
const items = index.items
  .filter((item) => item.kind === "model" && (!only || only.includes(item.family)))
  .slice(0, limit);

// Serve the turntable page with the project's own Vite and three.js.
const server = spawn("bunx", ["--no-install", "vite", "--config", "tools/studio/kit/vite.studio.mjs"], {
  env: { ...process.env, STUDIO_PORT: String(port) },
  shell: true,
  stdio: "ignore",
});
const url = `http://127.0.0.1:${port}/tools/studio/kit/turntable.html`;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(url)).ok) break;
  } catch {}
  await sleep(1000);
}

const { chromium } = await import(pathToFileURL(tools.playwright).href);
const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--window-size=900,900"] });
let rendered = 0;
try {
  const page = await (await browser.newContext({ viewport: { width: 800, height: 800 } })).newPage();
  await page.goto(url);
  await page.waitForFunction(() => !!window.__STUDIO__, null, { timeout: 120_000 });
  await page.evaluate((hex) => window.__STUDIO__.setBackground(hex), index.project.background ?? 0x2a2d31);
  const views = [35, 80, 125, 170, 215, 260, 305, 350];
  for (const item of items) {
    const dir = path.join(studio, "renders", item.family, item.id);
    const done = path.join(dir, "v7.webp");
    const wantsFilm = item.hero && !existsSync(path.join(studio, "turntables", `${item.id}.mp4`));
    const wantsSilhouette = item.silhouette && !existsSync(path.join(studio, "silhouettes", `${item.id}.png`));
    if (existsSync(done) && !wantsFilm && !wantsSilhouette) continue;
    await cool();
    mkdirSync(dir, { recursive: true });
    try {
      await page.evaluate(async (file) => await window.__STUDIO__.load(file), item.file);
      if (!existsSync(done)) {
        for (let v = 0; v < views.length; v++) {
          const [frame] = await page.evaluate((o) => window.__STUDIO__.render(o), {
            angles: [views[v]],
            size: size * 2,
            elevation: item.elevation ?? 20,
          });
          save(frame, path.join(dir, `v${v}.webp`), size);
        }
      }
      if (wantsFilm) {
        const frames = path.join(studio, "turntables", item.id);
        mkdirSync(frames, { recursive: true });
        for (let f = 0; f < 48; f++) {
          const [frame] = await page.evaluate((o) => window.__STUDIO__.render(o), { angles: [(f / 48) * 360], size: 1536, elevation: 16 });
          save(frame, path.join(frames, `f${String(f + 1).padStart(3, "0")}.jpg`), 768, 90);
        }
        execFileSync(tools.ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-framerate", "24", "-i", path.join(frames, "f%03d.jpg"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", path.join(studio, "turntables", `${item.id}.mp4`)]);
        rmSync(frames, { recursive: true, force: true });
      }
      if (wantsSilhouette) {
        const tiles = path.join(studio, "silhouettes", item.id);
        mkdirSync(tiles, { recursive: true });
        for (let a = 0; a < 12; a++) {
          const [frame] = await page.evaluate((o) => window.__STUDIO__.render(o), { angles: [a * 30], size: 1024, mode: "silhouette" });
          save(frame, path.join(tiles, `s${String(a).padStart(2, "0")}.png`), 512);
        }
        execFileSync(tools.magick, ["montage", path.join(tiles, "s*.png"), "-tile", "6x2", "-geometry", "512x512+0+0", path.join(studio, "silhouettes", `${item.id}.png`)]);
      }
      rendered++;
      if (rendered % 25 === 0) log(`${index.project.name}: ${rendered}/${items.length} rendered`);
    } catch (error) {
      log(`render failed ${item.id}: ${String(error).slice(0, 200)}`);
    }
  }
} finally {
  await browser.close().catch(() => {});
  if (process.platform === "win32") {
    try {
      execFileSync("powershell", ["-NoProfile", "-Command", `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`]);
    } catch {}
  } else server.kill();
}

// Contact sheets: one per family (first view), plus the texture library.
const families = [...new Set(items.map((item) => item.family))];
for (const family of families) {
  const tiles = items
    .filter((item) => item.family === family)
    .map((item) => path.join(studio, "renders", family, item.id, "v0.webp"))
    .filter((file) => existsSync(file));
  if (!tiles.length) continue;
  execFileSync(tools.magick, ["montage", ...tiles, "-tile", "8x", "-geometry", "360x360+4+4", "-background", "#16181b", path.join(docs, `${family}.jpg`)]);
}
const textureDir = path.join(studio, "textures");
if (existsSync(textureDir)) {
  const tiles = readdirSync(textureDir)
    .map((id) => path.join(textureDir, id, `${id}_colour.png`))
    .filter((file) => existsSync(file));
  if (tiles.length)
    execFileSync(tools.magick, ["montage", ...tiles, "-tile", "6x", "-geometry", "300x300+4+4", "-background", "#16181b", path.join(docs, "textures.jpg")]);
}
writeFileSync(path.join(docs, "render-summary.json"), JSON.stringify({ project: index.project.id, rendered, items: items.length, at: new Date().toISOString() }, null, 1));
log(`${index.project.name}: rendered ${rendered} of ${items.length}; contact sheets in docs/visual/studio/`);
