// Times and sanity-checks the procedural bear body (src/scene/bear-body.ts) outside the browser.
//   bun scripts/build-bear.ts [base voxel = 0.009] [shell voxel = 0.013]

import { buildBody, buildNose } from "../src/scene/bear-body";

const base = Number(process.argv[2] ?? 0.009);
const shells = Number(process.argv[3] ?? 0.013);
for (const voxel of [base, shells]) {
  const t0 = performance.now();
  const m = buildBody(voxel);
  const ms = Math.round(performance.now() - t0);
  const n = m.positions.length / 3;
  let badWeights = 0;
  for (let i = 0; i < n; i++) {
    const s =
      (m.weights[i * 4] as number) +
      (m.weights[i * 4 + 1] as number) +
      (m.weights[i * 4 + 2] as number) +
      (m.weights[i * 4 + 3] as number);
    if (s !== 255) badWeights++;
  }
  const pads = [...Array(n).keys()].filter((i) => (m.fur[i * 4 + 3] as number) > 128).length;
  console.log(
    JSON.stringify({ voxel, ms, vertices: n, triangles: m.indices.length / 3, badWeights, pads }),
  );
}
const t0 = performance.now();
const nose = buildNose();
console.log(
  JSON.stringify({ nose: nose.indices.length / 3, ms: Math.round(performance.now() - t0) }),
);
