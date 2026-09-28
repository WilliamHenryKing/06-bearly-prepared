#!/usr/bin/env bash
# Bear v2 final render batch (D14): evidence captures, look-dev turntables, gameplay films and
# README media, one job after another on the real GPU. Needs the dev server (4516) and the
# production preview (4616) running. Logs to docs/visual/batch/bear-v2/log.txt.
#   bash tools/batch/bear-v2-final.sh <scratch-dir>
set -u
SCRATCH="$1"
LOG=docs/visual/batch/bear-v2/log.txt
mkdir -p docs/visual/batch/bear-v2 "$SCRATCH"
step() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }

step "1/5 evidence: every bookmark on the GPU (production preview)"
VISUAL_URL="http://127.0.0.1:4616/?e2e" VISUAL_GPU=1 node scripts/visual-capture.ts bear-v2 >>"$LOG" 2>&1

step "2/5 look-dev turntables: dry, knee-wet, soaked, frizz"
for look in dry:"" wet:"&wet=0.4&soak=1" soaked:"&wet=1.6&soak=1" frizz:"&frizz=1&wet=0.3&soak=0.5"; do
  name="${look%%:*}"
  extra="${look#*:}"
  node --input-type=module - "$name" "$extra" "$SCRATCH" <<'EOF' >>"$LOG" 2>&1
const [name, extra, scratch] = process.argv.slice(2);
const { chromium } = await import("file:///C:/Users/William King/AppData/Local/npm-cache/_npx/81fb41e6b6793dc6/node_modules/playwright/index.mjs");
const { execFileSync } = await import("node:child_process");
const { mkdirSync } = await import("node:fs");
const MAGICK = "C:/Users/William King/.codex/tools/visual/ImageMagick-7.1.2-31/magick.exe";
const dir = `${scratch}/turn-${name}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11", "--enable-gpu"] });
const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
await page.goto(`http://127.0.0.1:4516/lookdev.html?cam=full&refs=0&load=0.3${extra}`);
await page.waitForFunction(() => window.__LOOKDEV__?.ready, null, { timeout: 120000 });
const base = Object.fromEntries(new URLSearchParams(`cam=full&refs=0&load=0.3${extra}`));
for (let i = 0; i < 36; i++) {
  await page.evaluate((p) => window.__LOOKDEV__.set(p), { ...base, angle: String(i * 10) });
  await page.evaluate(() => window.__LOOKDEV__.settle(4));
  await page.screenshot({ path: `${dir}/f_${String(i).padStart(3, "0")}.png` });
}
await browser.close();
execFileSync(MAGICK, ["-delay", "8", "-loop", "0", `${dir}/f_*.png`, "-resize", "480x", "-layers", "Optimize", `${scratch}/turn-${name}.gif`]);
console.log(`turntable ${name} done`);
EOF
done

step "3/5 gameplay films: pond crossing, climbing out and shaking, ledge gusts"
node tools/batch/game-film.mjs "$SCRATCH/film-pond" pond-approach 9 24 >>"$LOG" 2>&1
node tools/batch/game-film.mjs "$SCRATCH/film-shake" pond-exit 4.5 30 KeyW hold >>"$LOG" 2>&1
node tools/batch/game-film.mjs "$SCRATCH/film-ledge" ledge 7 24 >>"$LOG" 2>&1

step "4/5 walk cycle films from the look-dev profile camera"
node tools/batch/lookdev.mjs tools/batch/jobs/bear-walk-wet.json "$SCRATCH/walk" >>"$LOG" 2>&1

step "5/5 README media from the production preview"
node ../../tools/readme/capture.mjs "http://127.0.0.1:4616/" docs/readme ../../tools/readme/configs/06.json >>"$LOG" 2>&1

step "done"
