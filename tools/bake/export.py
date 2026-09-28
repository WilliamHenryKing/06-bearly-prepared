"""Landscape bake, final stage: the bake's grids → the game's vista assets (public/vista/).

- <grid>-h.bin.gz   heights, 1024² per grid, uint16 (height + 256 m) × 32, each row delta-coded,
                    gzip (the browser inflates it with DecompressionStream);
- <grid>-light.webp the baked radiance (sun, sky, bounce, cloud shadows), sRGB of radiance ÷ scale;
- inner-mat.webp    rock, forest, snow and water weights near the lookout, for close detail;
- forest.bin.gz     trees: x, z (float32), height (uint8, dm/2), tint (3 × uint8: their light);
- sky.webp          the path-traced sky, denoised (variance-guided), sRGB of radiance ÷ scale;
- vista.json        grids, scales, the sun's disc transmittance, and the horizon haze by azimuth
                    (what distant land fades into).
Half-resolution copies (-lo) serve the mobile tier.

Run: tools/bake/.venv/Scripts/python.exe tools/bake/export.py [--quick]
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = ROOT / "public" / "vista"


def srgb(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def to_u8(x: np.ndarray) -> np.ndarray:
    return (srgb(x) * 255 + 0.5).astype(np.uint8)


def down2(a: np.ndarray) -> np.ndarray:
    h, w = a.shape[:2]
    return a[: h // 2 * 2, : w // 2 * 2].reshape(h // 2, 2, w // 2, 2, *a.shape[2:]).mean(axis=(1, 3))


def heights(h: np.ndarray, path: Path) -> dict:
    q = np.clip(np.round((h.astype(np.float64) + 256.0) * 32.0), 0, 65535).astype(np.int32)
    d = q.copy()
    d[:, 1:] = q[:, 1:] - q[:, :-1]
    raw = (d & 0xFFFF).astype(np.uint16).tobytes()
    path.write_bytes(gzip.compress(raw, 9))
    return {"n": int(h.shape[0]), "offset": 256.0, "scale": 32.0, "bytes": path.stat().st_size}


def webp(img: np.ndarray, path: Path, quality: int = 90, lossless: bool = False):
    Image.fromarray(img).save(path, "WEBP", quality=quality, lossless=lossless, method=6)
    return path.stat().st_size


def denoise(pano: np.ndarray, var: np.ndarray, radius: int = 3, k: float = 4.0) -> np.ndarray:
    """Cross-bilateral filter on luminance with variance-scaled edge stopping (SVGF-style)."""
    rgb = pano[..., :3]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    out = np.zeros_like(rgb)
    wsum = np.zeros(lum.shape)
    sigma_s = radius * 0.6
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            ws = math.exp(-(dx * dx + dy * dy) / (2 * sigma_s * sigma_s))
            l2 = np.roll(np.roll(lum, dy, 0), dx, 1)
            v2 = np.roll(np.roll(var, dy, 0), dx, 1)
            c2 = np.roll(np.roll(rgb, dy, 0), dx, 1)
            w = ws * np.exp(-((lum - l2) ** 2) / (k * (var + v2) + 1e-6))
            out += c2 * w[..., None]
            wsum += w
    return out / wsum[..., None]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--trees", type=int, default=90000)
    args = ap.parse_args()
    work = ROOT / "bake" / "work" / ("quick" if args.quick else "")
    OUT.mkdir(parents=True, exist_ok=True)
    meta = json.loads((work / "streampower.json").read_text())
    sky = json.loads((ROOT / "bake" / "work" / "sky.json").read_text())
    info: dict = {"version": 1, "grids": {}, "files": {}}

    rads = {}
    for name in ("inner", "outer"):
        d = meta["domains"][name]
        n = int(d["n"])
        h = np.fromfile(work / f"{name}_h2.f32", dtype=np.float32).reshape(n, n)
        rads[name] = np.fromfile(work / f"{name}_radiance.f32", dtype=np.float32).reshape(n, n, 3)
        hh = down2(h) if n > 1024 else h
        info["grids"][name] = {
            "x0": d["cx"] - d["size"] / 2,
            "z0": d["cz"] - d["size"] / 2,
            "size": d["size"],
            "height": heights(hh, OUT / f"{name}-h.bin.gz"),
        }
    # One radiance scale for both grids: the 99.95th percentile of their brightest channel.
    both = np.concatenate([rads["inner"].reshape(-1, 3), rads["outer"].reshape(-1, 3)])
    scale = float(np.percentile(both.max(axis=1), 99.95)) * 1.05
    info["lightScale"] = scale
    for name in ("inner", "outer"):
        img = to_u8(rads[name] / scale)
        info["files"][f"{name}-light"] = webp(img, OUT / f"{name}-light.webp", 90)
        info["files"][f"{name}-light-lo"] = webp(to_u8(down2(rads[name]) / scale), OUT / f"{name}-light-lo.webp", 88)
        info["grids"][name]["light"] = int(img.shape[0])

    # Close detail near the lookout: rock, forest, snow, water.
    d = meta["domains"]["inner"]
    n = int(d["n"])
    mat = np.fromfile(work / "inner_mat.f32", dtype=np.float32).reshape(n, n, 4)
    water = np.fromfile(work / "inner_water.f32", dtype=np.float32).reshape(n, n)
    m4 = np.stack([mat[..., 1], mat[..., 2], mat[..., 3], water], -1)
    m4 = down2(m4) if n > 1024 else m4
    info["files"]["inner-mat"] = webp((np.clip(m4, 0, 1) * 255 + 0.5).astype(np.uint8), OUT / "inner-mat.webp", 92)

    # The lake: every cell under its water line that connects to its middle (a flood fill), so the
    # water shows exactly where the eroded basin holds it and nowhere else.
    h_in = np.fromfile(work / "inner_h2.f32", dtype=np.float32).reshape(n, n)
    below = h_in < -54.0 + 0.02
    x0 = d["cx"] - d["size"] / 2
    z0 = d["cz"] - d["size"] / 2
    dx = float(d["dx"])
    ci, cj = int((-470.0 - x0) / dx), int((330.0 - z0) / dx)
    lake = np.zeros_like(below)
    lake[cj, ci] = below[cj, ci]
    for _ in range(4000):
        grown = lake.copy()
        grown[1:] |= lake[:-1]
        grown[:-1] |= lake[1:]
        grown[:, 1:] |= lake[:, :-1]
        grown[:, :-1] |= lake[:, 1:]
        grown &= below
        if (grown == lake).all():
            break
        lake = grown
    # Widen by a cell so the water meets the shore under the land's own edge.
    wide = lake.copy()
    wide[1:] |= lake[:-1]
    wide[:-1] |= lake[1:]
    wide[:, 1:] |= lake[:, :-1]
    wide[:, :-1] |= lake[:, 1:]
    lm = wide.astype(np.float32)
    lm = down2(lm) if n > 1024 else lm
    info["files"]["lake"] = webp((np.clip(lm, 0, 1) * 255 + 0.5).astype(np.uint8), OUT / "lake.webp", 100, lossless=True)
    ys, xs = np.nonzero(lake)
    info["lake"] = {
        "cells": int(lake.sum()),
        "x": [float(x0 + xs.min() * dx), float(x0 + (xs.max() + 1) * dx)],
        "z": [float(z0 + ys.min() * dx), float(z0 + (ys.max() + 1) * dx)],
    }

    # Trees: a jittered grid over the inner grid, thinned by forest weight; lit like their crowns.
    rng = np.random.default_rng(4051)
    trees = []
    for name, spacing, keep_r in (("inner", 6.0, 1e9), ("outer", 12.0, 3200.0)):
        d = meta["domains"][name]
        n = int(d["n"])
        dx = float(d["dx"])
        x0 = d["cx"] - d["size"] / 2
        z0 = d["cz"] - d["size"] / 2
        h = np.fromfile(work / f"{name}_h2.f32", dtype=np.float32).reshape(n, n)
        can = np.fromfile(work / f"{name}_canopy.f32", dtype=np.float32).reshape(n, n)
        f = np.fromfile(work / f"{name}_mat.f32", dtype=np.float32).reshape(n, n, 4)[..., 2]
        sun_e = np.fromfile(work / f"{name}_sun.f32", dtype=np.float32).reshape(n, n, 3)
        sky_e = np.fromfile(work / f"{name}_sky.f32", dtype=np.float32).reshape(n, n, 3)
        m = int(d["size"] / spacing)
        gx, gz = np.meshgrid(np.arange(m), np.arange(m))
        px = x0 + (gx + rng.random(gx.shape)) * spacing
        pz = z0 + (gz + rng.random(gz.shape)) * spacing
        ci = np.clip(((px - x0) / dx).astype(int), 0, n - 1)
        cj = np.clip(((pz - z0) / dx).astype(int), 0, n - 1)
        w = f[cj, ci]
        ok = rng.random(w.shape) < w * 0.9
        if name == "outer":
            gi = info["grids"]["inner"]
            inside = (px > gi["x0"] + 60) & (px < gi["x0"] + gi["size"] - 60) & (pz > gi["z0"] + 60) & (pz < gi["z0"] + gi["size"] - 60)
            ok &= ~inside & (np.hypot(px + 40, pz - 20) < keep_r)
        # Keep the trail's own ground clear (the game plants its own firs there).
        ok &= np.hypot(px + 40, pz - 20) > 130
        sel = np.nonzero(ok)
        e = sun_e[cj[sel], ci[sel]] + sky_e[cj[sel], ci[sel]]
        trees.append(
            np.stack(
                [px[sel], pz[sel], can[cj[sel], ci[sel]] + rng.normal(0, 1.5, len(sel[0])), e[:, 0], e[:, 1], e[:, 2]], -1
            )
        )
    t = np.concatenate(trees)
    if len(t) > args.trees:
        # Keep the nearest ones: distant forest is already in the baked light.
        r = np.hypot(t[:, 0] + 146, t[:, 1] - 73)
        t = t[np.argsort(r)[: args.trees]]
    # Tint: each crown's light relative to open, sunlit ground.
    sun = np.array(sky["sun"]["direction"])
    pre = float(sky["preExposure"])
    e_open = float(np.array(sky["sunColour"]) @ [0.2126, 0.7152, 0.0722]) * float(sky["sunLux"]) * pre * max(sun[1], 0) * 1.25
    tint = np.clip(t[:, 3:6] / e_open, 0, 1.6) / 1.6
    rec = np.zeros(len(t), dtype=[("x", "<f4"), ("z", "<f4"), ("h", "u1"), ("r", "u1"), ("g", "u1"), ("b", "u1")])
    rec["x"] = t[:, 0]
    rec["z"] = t[:, 1]
    rec["h"] = np.clip(np.round(t[:, 2] * 5), 20, 255).astype(np.uint8)
    rec["r"], rec["g"], rec["b"] = [(np.clip(tint[:, k], 0, 1) * 255 + 0.5).astype(np.uint8) for k in range(3)]
    (OUT / "forest.bin.gz").write_bytes(gzip.compress(rec.tobytes(), 9))
    info["forest"] = {"count": int(len(t)), "stride": 12, "tintScale": 1.6}
    info["files"]["forest"] = (OUT / "forest.bin.gz").stat().st_size

    # The sky.
    sky_dir = work if (work / "sky_pano.json").exists() else ROOT / "bake" / "work" / "quick"
    pm = json.loads((sky_dir / "sky_pano.json").read_text())
    W, H = pm["width"], pm["height"]
    pano = np.fromfile(sky_dir / "sky_pano.f32", dtype=np.float32).reshape(H, W, 4)
    var_path = sky_dir / "sky_var.f32"
    rgb = pano[..., :3]
    if var_path.exists():
        var = np.fromfile(var_path, dtype=np.float32).reshape(H, W)
        rgb = denoise(pano, var)
    sky_scale = float(np.percentile(rgb.max(axis=-1), 99.9)) * 1.1
    info["sky"] = {
        "width": W,
        "height": H,
        "elTopDeg": pm["elTopDeg"],
        "elBottomDeg": pm["elBottomDeg"],
        "scale": sky_scale,
    }
    info["files"]["sky"] = webp(to_u8(rgb / sky_scale), OUT / "sky.webp", 92)
    info["files"]["sky-lo"] = webp(to_u8(down2(rgb) / sky_scale), OUT / "sky-lo.webp", 90)
    # How much cloud stands in front of the sun (for its disc and glare).
    el_top = math.radians(pm["elTopDeg"])
    el_bot = math.radians(pm["elBottomDeg"])
    s = sky["sun"]["direction"]
    phi = math.atan2(s[2], s[0]) % (2 * math.pi)
    el = math.asin(s[1])
    sx = int(phi / (2 * math.pi) * W)
    sy = int((el_top - el) / (el_top - el_bot) * H)
    info["sky"]["sunTransmittance"] = float(pano[max(0, sy - 2) : sy + 3, max(0, sx - 2) : sx + 3, 3].mean())
    # Horizon haze by azimuth: the sky just above the horizon, which distant land fades into.
    row0 = int((el_top - math.radians(3.0)) / (el_top - el_bot) * H)
    row1 = int((el_top - math.radians(0.5)) / (el_top - el_bot) * H)
    band = rgb[row0:row1].mean(axis=0)
    haze = band.reshape(256, W // 256, 3).mean(axis=1)
    info["sky"]["horizon"] = [round(float(v), 5) for v in haze.reshape(-1)]
    (OUT / "vista.json").write_text(json.dumps(info, indent=1))
    total = sum(v for v in info["files"].values()) + sum(g["height"]["bytes"] for g in info["grids"].values())
    print(json.dumps({k: v for k, v in info.items() if k != "sky"}, indent=1)[:1500])
    print(f"sky {W}×{H}, scale {sky_scale:.3f}, sun transmittance {info['sky']['sunTransmittance']:.2f}")
    print(f"total {total / 1e6:.2f} MB in public/vista/")


if __name__ == "__main__":
    main()
