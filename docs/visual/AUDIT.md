# Visual audit: BEARLY PREPARED

Evidence for the Visual Quality Directive fidelity pass. Captures come from the production
build served with `?e2e`, driven by `scripts/visual-capture.ts` through the
`window.__VISUAL_TEST__` hook (`src/visual-test.ts`). The camera bookmarks are defined in code
in `src/scene/bookmarks.ts`. Renderer used for every capture: headless Chromium on SwiftShader,
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`
(see `captures/*/renderer.txt`).

Scale: 1 placeholder · 2 tech demo · 3 competent indie · 4 premium studio web piece · 5 best in class.

Criteria: **L** light plausibility · **M** materials · **D** detail density · **E** environment
integration · **A** atmosphere and depth · **C** composition · **X** artefacts (5 = none) ·
**U** motion and UI integration.

## Bookmarks

| Bookmark | What it frames |
| --- | --- |
| `establishing` | High wide view over the meadow, the hairpin and the tree line |
| `hero` | Three-quarter view of the bear with the tall stack at the hairpin |
| `closeup` | Arm's length on the bear's face, the kettle and the blanket roll |
| `material` | Grazing angle over path, grass, stones and the first log |
| `ledge` | Over the drop at the windy ledge, rope fence and cliff |
| `hero-portrait` | The hero shot at 390 × 844 @2x |

## Baseline (captures/baseline)

| Bookmark | L | M | D | E | A | C | X | U | Mean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| establishing | 2 | 1 | 2 | 2 | 2 | 3 | 2 | 3 | 2.1 |
| hero | 2 | 2 | 2 | 2 | 2 | 3 | 2 | 3 | 2.3 |
| closeup | 2 | 2 | 1 | 2 | 2 | 3 | 2 | 3 | 2.1 |
| material | 2 | 1 | 1 | 2 | 2 | 2 | 2 | 3 | 1.9 |
| ledge | 2 | 1 | 2 | 2 | 2 | 3 | 2 | 3 | 2.1 |
| hero-portrait | 2 | 2 | 2 | 2 | 2 | 3 | 2 | 3 | 2.3 |
| **Overall** | | | | | | | | | **2.1** |

Verdict: a tidy tech demo. The character and layout read well, but almost everything is a
primitive with a flat colour.

### What the baseline shows

- **Lighting.** A hemisphere light plus a key light, and a sky dome that the lighting ignores.
  There is no environment map, so the enamel, ceramic and brass have nothing to reflect, and
  there is no ambient occlusion where objects meet the ground.
- **Ground.** The meadow is vertex-coloured flat green and the path is a flat tan ribbon, with
  no texture at the scale of the grazing shot.
- **Trees.** The pines are stacks of smooth cones, and the far tree line is single cones. Both
  read as placeholders.
- **Rocks.** The rocks are dodecahedra, faceted and plain grey.
- **Grass and flowers.** The grass is sparse three-blade tufts with gaps of bare ground between
  them. The flowers are small spheres on sticks.
- **Kit.** The pieces sit on the pack with visible gaps and no contact shadows. The kettle
  speckle reads as a pattern rather than enamel.
- **Felt.** The bear reads as smooth plastic up close: the fibre bump is too fine to register.
- **Sky and depth.** The mountains are faceted cones, the clouds are grey blobs, and the fog is
  flat and warm rather than blue with distance.
- **Artefacts.** Sign boards show blank backs, there is no anti-aliasing beyond MSAA, and
  there is visible shadow acne on the meadow.

## Ranked fix list

1. One lighting model: a physically based sun, an HDRI environment that matches the visible
   sky (PMREM), AgX applied once in an OutputPass, and exposure as the only brightness
   control. Remove the hemisphere rescue light.
2. Real ground: CC0 PBR grass, path and rock materials with a terrain splat, macro variation
   and two-scale sampling to break up tiling.
3. Replace the placeholder cones with modelled trees that have bark, drooping branch whorls
   and needle cards, instanced with jitter.
4. Replace the dodecahedra with scanned CC0 rocks and boulders.
5. Dense instanced grass cards (alpha-tested) and petal flowers that bend in the wind, with
   hue and scale jitter.
6. Post-processing: GTAO for contact, SMAA, a thresholded bloom that only touches the lit
   lamp, and a single OutputPass.
7. Aerial perspective: distance and height haze that turns blue toward the far ridges, and
   layered ridge silhouettes instead of cone mountains.
8. Felt with a fibre normal map and soft sheen on the bear. Real kit materials: enamel with
   chips, glazed ceramic, woven canvas and brushed brass.
9. Fitted, texel-snapped shadows; paint both faces of the signs.
10. A lower quality tier for phones.
