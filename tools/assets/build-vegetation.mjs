// Builds the shipped vegetation from the CC0 Poly Haven sources in assets-src/polyhaven/:
// - Geometry: each glTF with its images and materials stripped (the game supplies its own
//   material with alpha-to-coverage, wind sway and gust response), welded, optionally
//   simplified, meshopt-compressed → public/models/veg/<id>.glb.
// - Textures: colour with the separate alpha map merged in (RGBA WebP), OpenGL normal and ARM,
//   resized → public/textures/veg/<id>/<id>_{diff,nor,arm}.webp.
// Records the processing and the output files in assets.manifest.json.
//   node tools/assets/build-vegetation.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

const MAGICK = "C:/Users/William King/.codex/tools/visual/ImageMagick-7.1.2-31/magick.exe";
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";
const GT = ["-y", "@gltf-transform/cli@4.2.1"];
const UA = { headers: { "User-Agent": "Mozilla/5.0 (asset fetch for a CC0 portfolio project)" } };
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** id → texture size and optional simplification ratio. */
const ASSETS = {
  grass_medium_01: { size: 1024 },
  grass_medium_02: { size: 1024 },
  grass_bermuda_01: { size: 512 },
  shrub_sorrel_01: { size: 512 },
  fern_02: { size: 512 },
  flower_heliophila: { size: 512, simplify: 0.12 },
  moss_01: { size: 512 },
};

const gt = (...args) => execFileSync(NPX, [...GT, ...args], { stdio: "pipe", shell: true });
const manifest = JSON.parse(readFileSync("assets.manifest.json", "utf8"));

for (const [id, opts] of Object.entries(ASSETS)) {
  const src = `assets-src/polyhaven/${id}`;
  const tex = `public/textures/veg/${id}`;
  mkdirSync(tex, { recursive: true });
  mkdirSync("public/models/veg", { recursive: true });

  // The alpha map (not part of the glTF download).
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, UA)).json();
  const alphaUrl = files.Alpha?.["1k"]?.png?.url ?? files.Alpha?.["1k"]?.jpg?.url;
  const alphaPath = `${src}/textures/${id}_alpha_1k.${alphaUrl?.endsWith(".png") ? "png" : "jpg"}`;
  if (alphaUrl && !existsSync(alphaPath))
    writeFileSync(alphaPath, Buffer.from(await (await fetch(alphaUrl, UA)).arrayBuffer()));

  const size = `${opts.size}x${opts.size}`;
  const diff = `${src}/textures/${id}_diff_1k.jpg`;
  const outputs = [];
  const out = (p) => outputs.push({ path: p, bytes: statSync(p).size, sha256: sha(p) });
  if (alphaUrl) {
    execFileSync(MAGICK, [
      diff,
      alphaPath,
      "-alpha",
      "off",
      "-compose",
      "CopyOpacity",
      "-composite",
      "-resize",
      size,
      "-quality",
      "88",
      "-define",
      "webp:alpha-quality=90",
      `${tex}/${id}_diff.webp`,
    ]);
  } else {
    execFileSync(MAGICK, [diff, "-resize", size, "-quality", "88", `${tex}/${id}_diff.webp`]);
  }
  out(`${tex}/${id}_diff.webp`);
  execFileSync(MAGICK, [
    `${src}/textures/${id}_nor_gl_1k.jpg`,
    "-resize",
    size,
    "-quality",
    "90",
    `${tex}/${id}_nor.webp`,
  ]);
  out(`${tex}/${id}_nor.webp`);
  execFileSync(MAGICK, [
    `${src}/textures/${id}_arm_1k.jpg`,
    "-resize",
    size,
    "-quality",
    "90",
    `${tex}/${id}_arm.webp`,
  ]);
  out(`${tex}/${id}_arm.webp`);

  // Geometry only: drop images, textures and materials from the glTF JSON, then pack.
  const gltf = JSON.parse(readFileSync(`${src}/${id}.gltf`, "utf8"));
  delete gltf.images;
  delete gltf.textures;
  delete gltf.samplers;
  delete gltf.materials;
  for (const m of gltf.meshes) for (const p of m.primitives) delete p.material;
  const bare = `${src}/${id}.bare.gltf`;
  writeFileSync(bare, JSON.stringify(gltf));
  const tmp = `${src}/${id}.tmp.glb`;
  gt("copy", bare, tmp);
  gt("weld", tmp, tmp);
  if (opts.simplify) gt("simplify", tmp, tmp, "--ratio", String(opts.simplify), "--error", "0.002");
  const glb = `public/models/veg/${id}.glb`;
  gt("meshopt", tmp, glb, "--level", "medium");
  out(glb);

  const entry = manifest.assets.find((a) => a.id === `polyhaven-${id}`);
  if (entry) {
    if (alphaUrl && !entry.sources.some((s) => s.url === alphaUrl))
      entry.sources.push({
        file: alphaPath.slice(src.length + 1),
        url: alphaUrl,
        sha256: sha(alphaPath),
      });
    entry.processing = `glTF stripped of images/materials, welded${opts.simplify ? `, simplified to ${opts.simplify}` : ""}, meshopt; colour + alpha merged to RGBA WebP, normal and ARM WebP, all ${size}`;
    entry.outputFiles = outputs;
  }
  console.log(
    id,
    outputs.map((o) => `${o.path.split("/").pop()} ${Math.round(o.bytes / 1024)} KB`).join(", "),
  );
}
writeFileSync("assets.manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
