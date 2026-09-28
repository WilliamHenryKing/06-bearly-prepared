"""Landscape bake, stage C (GPU): render the sky panorama over the valley (clouds.py).

An equirectangular panorama from the lookout, 360° around and from the zenith to 12° below the
horizon. Each sample pass renders every pixel once with a fresh jitter, in tiles short enough for
the Windows GPU watchdog, paced by the thermal governor. The running sum is checkpointed so a
long render survives interruption (--resume). Output (bake/work/):
  sky_pano.f32  — H×W×4 float32: pre-exposed radiance (scene units) and the clouds'
                  transmittance along each view ray (for the sun's disc);
  sky_pano.jpg  — a tone-mapped preview (the game's Neutral curve, sRGB).

Run: tools/bake/.venv/Scripts/python.exe tools/bake/render_sky.py --width=8192 --spp=512
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import warp as wp
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
wp.config.kernel_cache_dir = str(HERE / ".cache")
wp.config.log_level = wp.LOG_WARNING

import atmos  # noqa: E402
import clouds  # noqa: E402
from governor import Governor  # noqa: E402

EL_TOP = math.pi / 2
EL_BOTTOM = -12 * math.pi / 180
# The lookout deck's eye (the trail's end, src/game/trail.ts), where the panorama is true.
CAMERA = (-146.0, 8.1, 72.9)


def neutral(c: np.ndarray) -> np.ndarray:
    """three.js NeutralToneMapping (Khronos PBR Neutral), then sRGB."""
    start = 0.76
    desat = 0.15
    x = c.min(axis=-1, keepdims=True)
    offset = np.where(x < 0.08, x - 6.25 * x * x, 0.04)
    c = c - offset
    peak = c.max(axis=-1, keepdims=True)
    d = 1 - start
    new_peak = 1 - d * d / (peak + d - start)
    scaled = c * np.where(peak > start, new_peak / np.maximum(peak, 1e-6), 1.0)
    g = 1 - 1 / (desat * (peak - new_peak) + 1)
    out = np.where(peak > start, scaled * (1 - g) + new_peak * g, c)
    out = np.clip(out, 0, 1)
    return np.where(out <= 0.0031308, out * 12.92, 1.055 * np.power(out, 1 / 2.4) - 0.055)


def preview(pano: np.ndarray, path: Path, width: int = 2048):
    h, w = pano.shape[:2]
    img = (neutral(pano[..., :3]) * 255).astype(np.uint8)
    im = Image.fromarray(img)
    im = im.resize((width, int(width * h / w)), Image.LANCZOS)
    im.save(path, quality=88)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--width", type=int, default=8192)
    ap.add_argument("--spp", type=int, default=512)
    ap.add_argument("--coverage", type=float, default=0.5)
    ap.add_argument("--clamp", type=float, default=12.0, help="per-sample cap, scene units")
    ap.add_argument("--stretch-from", type=int, default=16, help="events before free flights lengthen")
    ap.add_argument("--stretch-rate", type=float, default=0.95)
    ap.add_argument("--stretch-floor", type=float, default=0.5)
    ap.add_argument("--events", type=int, default=256)
    ap.add_argument("--tile", type=int, default=512)
    ap.add_argument("--out", default="bake/work")
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    out = ROOT / args.out
    out.mkdir(parents=True, exist_ok=True)
    width = args.width
    height = int(round(width * (EL_TOP - EL_BOTTOM) / (2 * math.pi)))
    sky = atmos.SKY
    sun = sky["sun"]["direction"]
    lux = float(sky["sunLux"])
    solar = float(sky["atmosphere"]["SOLAR_ILLUMINANCE"])
    sun_rgb = sky["sunColour"]
    pre = float(sky["preExposure"])

    wp.init()
    dev = "cuda:0"
    t0 = time.time()
    shape, detail = clouds.build_volumes(dev)
    wm, bounds = clouds.build_weather_map(args.coverage, dev)

    # Sky at ground level: its irradiance lights the ground the clouds see below them.
    ground_lut = clouds.sky_lut(sun, solar, 0.0, (0.0, 0.0, 0.0), 256, 128, dev).numpy()
    el = np.pi / 2 - (np.arange(128) + 0.5) / 128 * np.pi
    w_el = np.maximum(np.sin(el), 0) * np.cos(el) * (np.pi / 128) * (2 * np.pi / 256)
    e_sky = (ground_lut * w_el[:, None, None]).sum(axis=(0, 1))
    e_sun = np.array(sun_rgb) * lux * max(sun[1], 0.0) * 0.72  # some of the ground is in cloud shadow
    albedo = np.array([0.105, 0.125, 0.075])  # meadow, forest and rock seen from above
    ground = albedo / math.pi * (e_sun + e_sky)
    ground_rgb = tuple(float(v) for v in ground)
    lut = clouds.sky_lut(sun, solar, 3000.0, ground_rgb, 512, 256, dev)
    sky_amb = tuple(float(v) for v in e_sky)

    acc_path = out / "sky_accum.npy"
    acc2_path = out / "sky_accum2.npy"
    meta_path = out / "sky_accum.json"
    done = 0
    if args.resume and acc_path.exists():
        m = json.loads(meta_path.read_text())
        if m["width"] == width and m["coverage"] == args.coverage:
            done = m["spp"]
            acc = wp.array(np.load(acc_path), dtype=wp.vec4, device=dev)
            acc2 = wp.array(np.load(acc2_path), dtype=float, device=dev)
            print(f"resuming at {done} spp", flush=True)
        else:
            acc = wp.zeros((height, width), dtype=wp.vec4, device=dev)
            acc2 = wp.zeros((height, width), dtype=float, device=dev)
    else:
        acc = wp.zeros((height, width), dtype=wp.vec4, device=dev)
        acc2 = wp.zeros((height, width), dtype=float, device=dev)

    gov = Governor(ROOT / "bake" / "work" / "thermal.csv", f"sky {width}x{height}")
    tile = args.tile
    tiles = [(x, y) for y in range(0, height, tile // 2) for x in range(0, width, tile)]
    print(f"sky {width}×{height}, {len(tiles)} tiles per pass, {args.spp} spp; setup {time.time() - t0:.1f} s", flush=True)
    start = time.time()
    last_save = time.time()
    for sample in range(done, args.spp):
        for x, y in tiles:
            tw = min(tile, width - x)
            th = min(tile // 2, height - y)
            wp.launch(
                clouds.render_pano,
                dim=(th, tw),
                inputs=[
                    acc, acc2, x, y, tw, th, width, height, EL_TOP, EL_BOTTOM,
                    wp.vec3(*CAMERA), wp.vec3(*sun), wp.vec3(*sun_rgb), solar,
                    wm, bounds, shape, detail, lut, wp.vec3(*sky_amb), wp.vec3(*ground_rgb), sample, args.events,
                    args.clamp / pre, args.stretch_from, args.stretch_rate, args.stretch_floor,
                ],
                device=dev,
            )
            wp.synchronize_device(dev)
            gov.pace()
        n = sample + 1
        el_s = time.time() - start
        per = el_s / max(1, n - done)
        if n in (done + 1, done + 2) or n % 8 == 0 or n == args.spp:
            print(f"  {n}/{args.spp} spp, {per:.1f} s each, eta {per * (args.spp - n) / 60:.1f} min", flush=True)
        if time.time() - last_save > 300 or n == args.spp:
            np.save(acc_path, acc.numpy())
            np.save(acc2_path, acc2.numpy())
            meta_path.write_text(json.dumps({"width": width, "coverage": args.coverage, "spp": n}))
            last_save = time.time()
            pano = acc.numpy() / n
            pano[..., :3] *= pre
            preview(pano, out / "sky_pano.jpg")

    pano = acc.numpy() / args.spp
    pano[..., :3] *= pre
    pano.astype(np.float32).tofile(out / "sky_pano.f32")
    # Variance of each pixel's mean luminance (scene units²), for the denoiser.
    lum = pano[..., 0] * 0.2126 + pano[..., 1] * 0.7152 + pano[..., 2] * 0.0722
    var = np.maximum(acc2.numpy() / args.spp * pre * pre - lum * lum, 0) / args.spp
    var.astype(np.float32).tofile(out / "sky_var.f32")
    (out / "sky_pano.json").write_text(
        json.dumps(
            {
                "width": width,
                "height": height,
                "elTopDeg": 90.0,
                "elBottomDeg": EL_BOTTOM * 180 / math.pi,
                "camera": CAMERA,
                "spp": args.spp,
                "coverage": args.coverage,
                "seconds": round(time.time() - t0),
                "thermal": gov.summary(),
            },
            indent=2,
        )
    )
    preview(pano, out / "sky_pano.jpg")
    print(gov.summary(), flush=True)
    gov.close()


if __name__ == "__main__":
    main()
