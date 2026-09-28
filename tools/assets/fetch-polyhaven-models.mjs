// Fetches CC0 models from Poly Haven (glTF with its textures) into assets-src/polyhaven/<id>/ and
// records each source file's URL and sha256 in assets.manifest.json (the processing step, and the
// shipped files, are added by tools/assets/build-vegetation.mjs).
//   node tools/assets/fetch-polyhaven-models.mjs [id=res …]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT = [
  "grass_medium_01=1k",
  "grass_medium_02=1k",
  "grass_bermuda_01=1k",
  "shrub_sorrel_01=1k",
  "flower_heliophila=1k",
  "fern_02=1k",
  "moss_01=1k",
  "pine_tree_01=1k",
  "fir_tree_01=1k",
  "fir_sapling=1k",
];
const wanted = (process.argv.length > 2 ? process.argv.slice(2) : DEFAULT).map((a) => {
  const [id, res = "1k"] = a.split("=");
  return { id, res };
});
const UA = { headers: { "User-Agent": "Mozilla/5.0 (asset fetch for a CC0 portfolio project)" } };
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

const manifestPath = "assets.manifest.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

for (const { id, res } of wanted) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, UA)).json();
  const info = await (await fetch(`https://api.polyhaven.com/info/${id}`, UA)).json();
  const entry = files.gltf?.[res]?.gltf;
  if (!entry) {
    console.log(`${id}: no ${res} glTF`);
    continue;
  }
  const dir = `assets-src/polyhaven/${id}`;
  const sources = [];
  const get = async (url, path) => {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path))
      writeFileSync(path, Buffer.from(await (await fetch(url, UA)).arrayBuffer()));
    sources.push({ file: path.slice(dir.length + 1), url, sha256: sha(readFileSync(path)) });
  };
  await get(entry.url, `${dir}/${id}.gltf`);
  for (const [rel, inc] of Object.entries(entry.include ?? {})) await get(inc.url, `${dir}/${rel}`);
  manifest.assets = manifest.assets.filter((a) => a.id !== `polyhaven-${id}`);
  manifest.assets.push({
    id: `polyhaven-${id}`,
    title: info.name ?? id,
    sourceUrl: `https://polyhaven.com/a/${id}`,
    author: Object.keys(info.authors ?? { "Poly Haven": 1 }).join(", "),
    license: "CC0 1.0",
    retrievalDate: new Date().toISOString().slice(0, 10),
    sources,
    processing: "pending: tools/assets/build-vegetation.mjs",
    outputFiles: [],
  });
  console.log(`${id}: ${sources.length} files, ${info.polycount ?? "?"} polys`);
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
