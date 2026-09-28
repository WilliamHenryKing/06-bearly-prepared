// Builds the park crowd from Quaternius's CC0 Ultimate Modular Characters / Women packs
// (assets-src/quaternius/people/, glTF with embedded buffers):
// - Every character's mesh and skeleton without animations: public/models/people/<name>.glb.
// - One shared animation file with the clips the crowd uses (they share one 62-bone rig, so
//   clips bind by bone name): public/models/people/anims.glb.
// meshopt-compressed; recorded in assets.manifest.json.
//   node tools/assets/build-people.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

const NPX = process.platform === "win32" ? "npx.cmd" : "npx";
const gt = (...args) =>
  execFileSync(NPX, ["-y", "@gltf-transform/cli@4.2.1", ...args], { stdio: "pipe", shell: true });
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const SRC = "assets-src/quaternius/people";
const OUT = "public/models/people";
const CLIPS = ["Walk", "Idle", "Idle_Neutral", "HitRecieve", "Wave", "Interact"];
mkdirSync(OUT, { recursive: true });

const outputs = [];
const sources = [];
for (const file of readdirSync(SRC).filter((f) => f.endsWith(".gltf") && !f.includes(".tmp"))) {
  const name = file.replace(".gltf", "");
  sources.push({ file, sha256: sha(`${SRC}/${file}`) });
  const gltf = JSON.parse(readFileSync(`${SRC}/${file}`, "utf8"));
  delete gltf.animations;
  writeFileSync(`${SRC}/${name}.tmp.gltf`, JSON.stringify(gltf));
  gt("copy", `${SRC}/${name}.tmp.gltf`, `${SRC}/${name}.tmp.glb`);
  gt("prune", `${SRC}/${name}.tmp.glb`, `${SRC}/${name}.tmp.glb`);
  gt("meshopt", `${SRC}/${name}.tmp.glb`, `${OUT}/${name}.glb`, "--level", "medium");
  outputs.push({
    path: `${OUT}/${name}.glb`,
    bytes: statSync(`${OUT}/${name}.glb`).size,
    sha256: sha(`${OUT}/${name}.glb`),
  });
  console.log(name, Math.round(statSync(`${OUT}/${name}.glb`).size / 1024), "KB");
}

// The clips, from one character: keep only the ones the crowd plays.
const donor = JSON.parse(readFileSync(`${SRC}/m_Suit.gltf`, "utf8"));
donor.animations = donor.animations.filter((a) => CLIPS.includes(a.name));
writeFileSync(`${SRC}/anims.tmp.gltf`, JSON.stringify(donor));
gt("copy", `${SRC}/anims.tmp.gltf`, `${SRC}/anims.tmp.glb`);
gt("prune", `${SRC}/anims.tmp.glb`, `${SRC}/anims.tmp.glb`);
gt("resample", `${SRC}/anims.tmp.glb`, `${SRC}/anims.tmp.glb`);
gt("meshopt", `${SRC}/anims.tmp.glb`, `${OUT}/anims.glb`, "--level", "medium");
outputs.push({
  path: `${OUT}/anims.glb`,
  bytes: statSync(`${OUT}/anims.glb`).size,
  sha256: sha(`${OUT}/anims.glb`),
});
console.log("anims", Math.round(statSync(`${OUT}/anims.glb`).size / 1024), "KB", CLIPS.join(" "));

const manifest = JSON.parse(readFileSync("assets.manifest.json", "utf8"));
manifest.assets = manifest.assets.filter((a) => a.id !== "quaternius-modular-characters");
manifest.assets.push({
  id: "quaternius-modular-characters",
  title: "Ultimate Modular Characters and Ultimate Modular Women (individual characters, glTF)",
  sourceUrl: "https://quaternius.com/packs/ultimatemodularcharacters.html",
  sourceUrl2: "https://quaternius.com/packs/ultimatemodularwomen.html",
  author: "Quaternius",
  license: "CC0 1.0",
  retrievalDate: new Date().toISOString().slice(0, 10),
  sources,
  processing: `animations stripped from each character (glb, pruned, meshopt); clips ${CLIPS.join(", ")} kept from m_Suit in anims.glb (resampled, meshopt); smooth normals rebuilt at load`,
  outputFiles: outputs,
});
writeFileSync("assets.manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
