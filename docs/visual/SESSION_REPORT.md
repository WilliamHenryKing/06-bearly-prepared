# Fidelity pass: session report (stopped early)

The session stopped on request when the cloud credit ran out. The work continues locally from
branch `cloud-v1`.

**State at stop:** `bun run check` passes (strict tsc, Biome, 26 tests, production build). I did
not re-run the end-to-end test (`bun run e2e`) after the fidelity changes, so run it locally
first.

## Scores

| | Baseline | After |
| --- | --- | --- |
| Overall mean (docs/visual/AUDIT.md) | 2.1 | Not scored yet: the after-set was never captured |

Work-in-progress captures are in `docs/visual/captures/wip/`: hero, establishing, material and
closeup. My unscored impression of `wip/hero.png` and `wip/closeup.png` is roughly 3 (competent
indie) for lighting, materials and detail, up from 2.

## Shipped assets

About 6.1 MB in total, against the 25 MB budget:
- textures: 4.4 MB (WebP);
- models: 0.8 MB (meshopt with WebP);
- audio: 0.9 MB.

`assets.manifest.json` records the source URL, author, licence, date, sha256 and processing
steps for every file.

After the manifest was written, `public/models/rock_moss_set_01.glb` and `dandelion_01.glb`
were re-optimised with `--join false`. Their manifest bytes and sha256 values are therefore
stale and must be regenerated.

## What changed (commits on cloud-v1)

1. **Evidence.** Added the `window.__VISUAL_TEST__` hook (dev builds and `?e2e` only;
   `src/visual-test.ts`) and six camera bookmarks (`src/scene/bookmarks.ts`). The capture script
   is `scripts/visual-capture.ts`, and it logs the renderer string. Baseline captures and the
   audit are in `docs/visual/captures/baseline/` and `docs/visual/AUDIT.md`.
2. **One lighting model**, adapted from ODD TIDE with permission:
   - the physical atmosphere, sky dome and sky model (`src/scene/render/`), re-placed as an
     alpine meadow at 46° N at 17:24;
   - a sun in lux with a single pre-exposure, and the sky baked to a PMREM environment;
   - aerial perspective tinted with the sky's horizon radiance (4 km visibility);
   - post-processing: MSAA HDR target → GTAO → thresholded bloom → OutputPass (Neutral tone
     mapping, applied once) → SMAA;
   - texel-snapped sun shadows;
   - quality tiers (phones get no GTAO and no MSAA), plus an adaptive step that drops GTAO and
     then resolution once frames average over 16.7 ms for 2 s;
   - removed: the hemisphere fill light, the cone mountains and the blob clouds.
3. **Real ground.** Poly Haven grass_ground turf, sampled at two scales with macro colour
   variation and re-graded greener. The trail uses rocky_trail, feathered into a dirt verge, and
   the ledge and cliffs use triplanar rock_face_03 (`src/scene/terrain-material.ts`).
4. **Vegetation** (`src/scene/vegetation.ts`, `src/scene/trees.ts`), all instanced with scale,
   rotation and hue jitter, and all bending in the gust-aware wind:
   - alpha-tested grass cards cut from the scanned grass_medium_02 blade atlas;
   - leaf-card shrub domes;
   - scanned dandelions and scanned mossy rocks and pebbles;
   - modelled firs with bark-textured trunks and drooping needle-card whorls, near the trail and
     on the far tree line.
5. **Materials** (this final commit):
   - a registry upgrades felt, painted wood, cloth and bark with scanned normal and ARM maps
     (wool_boucle, distressed_painted_planks, hessian_230, bark_brown_02);
   - brushed anisotropic brass on the lamp;
   - clearcoat enamel on the kettle and glazed ceramic on the cups;
   - bark on the logs, and a canvas backpack.

## Access

- **ODD TIDE:** a plain `git clone` failed (no credentials), so I attached the repository to
  the session read-only and cloned it to `/tmp/odd-tide`. I copied code and textures from it
  with their provenance; there are no runtime imports.
- **Asset sites:** Poly Haven and ambientCG were reachable. Poly Haven's API refused Python's
  default user agent; curl worked.
- **Replies to the integrator:** this session cannot send cross-session messages, so replies go
  in this file and in commit messages.

## What is left, in order

1. **After-captures and scoring.** Run `bun run build`, start the preview on port 4616, then run
   `bun scripts/visual-capture.ts after`. Score every bookmark in `AUDIT.md`, list the three most
   visible remaining flaws per bookmark, and write down the target luminance relationships. Each
   SwiftShader capture takes about 2 minutes at 1440 × 900.
2. **Far ridges.** The environment bake's dark below-horizon band still shows beyond the
   terrain edge in wide shots. Add layered ridge silhouettes, or extend the terrain, so the
   aerial perspective reads against real far hills.
3. **Close-up materials.** The felt normal shows in the close-up but is subtle. The blanket's
   tartan still reads flat. The teacup crate is untextured green, so give it painted wood.
4. **Grass density near the camera.** It is still sparse in the foreground of the hero shot;
   check the cost on a GPU first, because the adaptive step exists for exactly this.
5. **Contact.** GTAO provides some. Check that the kit sits on the pack without gaps.
6. **Manifest.** Regenerate `assets.manifest.json` for the two re-optimised GLBs. The two unused
   23k-triangle dandelion LOD0 meshes could also be pruned from `dandelion_01.glb`.
7. **README media.** Refresh `docs/readme/desktop.png`, `phone.png` and `preview.gif` (disposal
   "none") to show the new look, and update the README credits with the visual assets.
8. **Tests.** Run `bun run e2e`. Check frame rate and loader time on a real GPU; the loader now
   waits for about 5 MB of textures.
