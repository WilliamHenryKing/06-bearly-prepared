// Studio builder: turns a project's recipes (tools/studio/recipes.ts) into meshed, simplified,
// meshopt-compressed glTF models and tileable PBR texture sets, in parallel worker processes.
// Usage (from the project root): bun tools/studio/kit/build.ts [--only fam,fam] [--limit n]
//   [--workers n] [--skip-textures] [--skip-models]
// Output: assets-src/studio/models/<family>/<id>.glb, assets-src/studio/textures/<id>/,
// and assets-src/studio/index.json (read by the turntable renderer).
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { meshNode, toGlb } from "./mesh";
import type { Node } from "./sdf";
import { encodePng, synthesise, type TextureRecipe } from "./textures";

export type Family = {
  id: string;
  /** Number of seeded variants. */
  count: number;
  /** Grid cell size in metres (sets detail and cost). */
  voxel: number;
  /** Target share of triangles kept by simplification (0–1, default 0.3). */
  keep?: number;
  hero?: boolean;
  silhouette?: boolean;
  wear?: number;
  dirt?: number;
  build: (seed: number, index: number) => Node;
};
export type Recipes = {
  project: { id: string; name: string; background: number };
  families: Family[];
  textures: TextureRecipe[];
};

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? (args[args.indexOf(name) + 1] as string) : undefined);
const only = flag("--only")?.split(",");
const limit = Number(flag("--limit") ?? Number.POSITIVE_INFINITY);
const root = process.cwd();
const out = path.join(root, "assets-src", "studio");
const recipes = (await import(path.join(root, "tools", "studio", "recipes.ts"))) as Recipes;

type Job =
  | { kind: "model"; family: string; index: number; id: string }
  | { kind: "texture"; id: string };
const jobs: Job[] = [];
if (!args.includes("--skip-models"))
  for (const family of recipes.families) {
    if (only && !only.includes(family.id)) continue;
    for (let i = 0; i < Math.min(family.count, limit); i++)
      jobs.push({ kind: "model", family: family.id, index: i, id: `${family.id}-${String(i + 1).padStart(3, "0")}` });
  }
if (!args.includes("--skip-textures"))
  for (const texture of recipes.textures) if (!only || only.includes(texture.id)) jobs.push({ kind: "texture", id: texture.id });

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const quote = (a: string) => (process.platform === "win32" && a.includes(" ") ? `"${a}"` : a);
const transform = (...a: string[]) =>
  execFileSync(npx, ["--yes", "@gltf-transform/cli@4.5.0", ...a].map(quote), {
    stdio: "pipe",
    shell: process.platform === "win32",
  });

async function work(worker: number, of: number) {
  const results = path.join(out, `results-${worker}.jsonl`);
  for (let j = worker; j < jobs.length; j += of) {
    const job = jobs[j] as Job;
    const started = performance.now();
    try {
      if (job.kind === "model") {
        const family = recipes.families.find((f) => f.id === job.family) as Family;
        const dir = path.join(out, "models", family.id);
        mkdirSync(dir, { recursive: true });
        const final = path.join(dir, `${job.id}.glb`);
        if (existsSync(final)) continue;
        const seed = (job.index + 1) * 7919 + family.id.length * 104729;
        const node = family.build(seed, job.index);
        const mesh = meshNode(node, family.voxel, { wear: family.wear, dirt: family.dirt });
        const raw = path.join(dir, `${job.id}.raw.glb`);
        writeFileSync(raw, toGlb(mesh, { id: job.id, family: family.id, seed }));
        const tris = mesh.indices.length / 3;
        const simplified = path.join(dir, `${job.id}.simp.glb`);
        transform("simplify", raw, simplified, "--ratio", String(family.keep ?? 0.3), "--error", "0.0008");
        transform("meshopt", simplified, final, "--level", "medium");
        rmSync(raw);
        rmSync(simplified);
        appendFileSync(
          results,
          `${JSON.stringify({
            kind: "model",
            id: job.id,
            family: family.id,
            file: `/assets-src/studio/models/${family.id}/${job.id}.glb`,
            sourceTriangles: tris,
            bytes: statSync(final).size,
            hero: !!family.hero,
            silhouette: !!family.silhouette,
            seconds: Math.round((performance.now() - started) / 100) / 10,
          })}\n`,
        );
      } else {
        const recipe = recipes.textures.find((t) => t.id === job.id) as TextureRecipe;
        const dir = path.join(out, "textures", recipe.id);
        mkdirSync(dir, { recursive: true });
        const size = 2048;
        const maps = synthesise(recipe, size);
        writeFileSync(path.join(dir, `${recipe.id}_colour.png`), encodePng(maps.colour, size, size));
        writeFileSync(path.join(dir, `${recipe.id}_orm.png`), encodePng(maps.rough, size, size));
        writeFileSync(path.join(dir, `${recipe.id}_normal.png`), encodePng(maps.normal, size, size));
        appendFileSync(
          results,
          `${JSON.stringify({ kind: "texture", id: recipe.id, dir: `/assets-src/studio/textures/${recipe.id}/`, seconds: Math.round((performance.now() - started) / 100) / 10 })}\n`,
        );
      }
    } catch (error) {
      appendFileSync(results, `${JSON.stringify({ kind: "error", id: job.id, error: String(error).slice(0, 300) })}\n`);
    }
  }
}

if (args.includes("--worker")) {
  await work(Number(flag("--worker")), Number(flag("--of")));
} else {
  mkdirSync(out, { recursive: true });
  const workers = Number(flag("--workers") ?? Math.max(2, os.cpus().length - 2));
  for (let w = 0; w < workers; w++) rmSync(path.join(out, `results-${w}.jsonl`), { force: true });
  const started = Date.now();
  console.log(`${recipes.project.name}: ${jobs.length} jobs on ${workers} workers`);
  await Promise.all(
    Array.from({ length: workers }, (_, w) =>
      new Promise<void>((resolve) => {
        const child = spawn(process.execPath, [path.join(import.meta.dir, "build.ts"), ...args, "--worker", String(w), "--of", String(workers)], { stdio: "inherit" });
        child.on("exit", () => resolve());
      }),
    ),
  );
  // Merge this run's results with the existing index (assets built by earlier runs stay listed).
  const indexFile = path.join(out, "index.json");
  const previous = existsSync(indexFile) ? (JSON.parse(readFileSync(indexFile, "utf8")) as { items: { id: string }[] }).items : [];
  const fresh: { id: string; kind: string }[] = [];
  for (let w = 0; w < workers; w++) {
    const file = path.join(out, `results-${w}.jsonl`);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) if (line.trim()) fresh.push(JSON.parse(line));
  }
  const byId = new Map(previous.map((item) => [item.id, item]));
  for (const item of fresh) if (item.kind !== "error") byId.set(item.id, item);
  const errors = fresh.filter((item) => item.kind === "error");
  writeFileSync(
    indexFile,
    JSON.stringify({ project: recipes.project, built: new Date().toISOString(), items: [...byId.values()] }, null, 1),
  );
  console.log(`built ${fresh.length - errors.length}, errors ${errors.length}, ${Math.round((Date.now() - started) / 1000)} s`);
  for (const e of errors.slice(0, 5)) console.log(JSON.stringify(e));
}
