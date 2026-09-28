# The vista bake

The mountains, valley, lake shore, forests and sky that the bear looks out on are rendered offline on this machine's RTX 2060 and shipped as compact assets in `public/vista/` (about 8 MB). At runtime the game reads these assets. It does not simulate or path-trace anything.

| Stage | What it does | Where it runs | Time (RTX 2060, i7-10750H) |
| --- | --- | --- | --- |
| A1 `streampower.mjs` | Designed land → tectonic uplift against stream-power river incision. Cordonnier et al. 2016, solved with Braun & Willett 2013 over Priority-Flood + ε routing. Outer grid: 16.4 km at 8 m. Inner grid: 4 km at 2 m. The trail's plateau is held fixed. | CPU (Bun) | ~58 min |
| A2 `erode_gpu.py` | 40 M + 20 M droplets of hydraulic erosion (after Beyer 2015) with atomic scatter, then a talus pass. | CUDA (NVIDIA Warp) | ~2 min |
| C `render_sky.py` | 8192 × 2321 equirectangular sky, 768 samples per pixel. Cumulus are path-traced by delta tracking. The phase function is approximate Mie (Jendersie & d'Eon 2023). The sun disc is sampled. The atmosphere is the game's own, ported. Cirrus uses single scattering. | CUDA | ~60 min |
| B `light_gpu.py` | Materials come from the erosion record. Light has three parts: a soft sun (disc-sampled, terrain and canopy occlusion, cloud shadows), a 4,096-ray sky gather against the panorama, and one bounce. | CUDA | ~16 min |
| export `export.py` | Delta-coded 16-bit heights, sRGB WebP light maps, the flood-filled lake mask, lit tree instances, a variance-guided denoised sky and a per-azimuth horizon haze table. | CPU | ~3 min |

`sky-params.mjs` exports the game's sun, exposure and atmosphere constants to `bake/work/sky.json`. `atmos.py` checks its CUDA port against them; the worst relative error is 6.7 × 10⁻⁵.

## Run

```sh
python -m venv tools/bake/.venv && tools/bake/.venv/Scripts/python.exe -m pip install warp-lang numpy pillow
bun tools/bake/sky-params.mjs
bun tools/bake/streampower.mjs --iters=900 --innerIters=200     # stage A1
bash tools/bake/run-land.sh                                     # A2 → B (quick sky) → export
bash tools/bake/run-sky.sh 768                                  # C → B under the final sky → export
```

Add `--quick` to any stage for a low-resolution trial in `bake/work/quick/`, which takes seconds to a minute. Intermediate grids live in `bake/work/`, which is git-ignored.

## Machine budget

Every GPU stage runs in short kernel launches under the Windows watchdog, paced by `governor.py`, which follows `docs/visual/LOCAL_MACHINE_BUDGET.md`:

- It idles above 81 °C and resumes at 76 °C, against the hard stop at 85 °C.
- It refuses to run with less than 1 GiB of GPU memory free.

Temperatures and memory are logged to `bake/work/thermal.csv`. Only one heavy stage runs at a time.
