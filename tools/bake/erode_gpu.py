"""Landscape bake, stage A2 (GPU, CUDA via NVIDIA Warp): droplet erosion and talus.

Tens of millions of raindrops run down the stream-power terrain (stage A1), each one picking up
sediment where it speeds downhill and dropping it where it slows: gullies cut the slopes, fans
spread where they open onto flatter ground, and deltas build where streams reach the lake. The
droplet model follows Hans Theobald Beyer, "Implementation of a method for hydraulic erosion"
(TU München, 2015), run massively in parallel with atomic writes. A talus pass then settles
loose material steeper than its angle of repose, which varies across the rock so some cliffs
stand. The plateau (the game's own ground) and the lake bed are never touched, and erosion
fades out toward the inner grid's edge so it still meets the outer grid.

Run: tools/bake/.venv/Scripts/python.exe tools/bake/erode_gpu.py [--quick] [--droplets=M]
Reads and writes bake/work/ (float32 grids); logs GPU temperature to bake/work/thermal.csv.
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

from governor import Governor

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
wp.config.kernel_cache_dir = str(HERE / ".cache")
wp.config.log_level = wp.LOG_WARNING

LAKE_LEVEL = -54.0


@wp.kernel
def rain(
    h: wp.array2d(dtype=float),
    erod: wp.array2d(dtype=float),
    flow: wp.array2d(dtype=float),
    dep: wp.array2d(dtype=float),
    cut: wp.array2d(dtype=float),
    n: int,
    seed: int,
    lifetime: int,
    dx: float,
    inertia: float,
    cap_k: float,
    cap_min: float,
    erode_k: float,
    deposit_k: float,
    evaporate: float,
    gravity: float,
    radius: int,
    lake: float,
):
    tid = wp.tid()
    rng = wp.rand_init(seed, tid)
    x = 1.0 + wp.randf(rng) * float(n - 4)
    z = 1.0 + wp.randf(rng) * float(n - 4)
    if erod[int(z), int(x)] <= 0.0:
        return
    dx_ = float(0.0)
    dz_ = float(0.0)
    speed = float(1.0)
    water = float(1.0)
    sed = float(0.0)
    rf = float(radius)
    for _step in range(lifetime):
        ix = int(x)
        iz = int(z)
        fx = x - float(ix)
        fz = z - float(iz)
        h00 = h[iz, ix]
        h10 = h[iz, ix + 1]
        h01 = h[iz + 1, ix]
        h11 = h[iz + 1, ix + 1]
        gx = ((h10 - h00) * (1.0 - fz) + (h11 - h01) * fz) / dx
        gz = ((h01 - h00) * (1.0 - fx) + (h11 - h10) * fx) / dx
        here = h00 * (1.0 - fx) * (1.0 - fz) + h10 * fx * (1.0 - fz) + h01 * (1.0 - fx) * fz + h11 * fx * fz
        dx_ = dx_ * inertia - gx * (1.0 - inertia)
        dz_ = dz_ * inertia - gz * (1.0 - inertia)
        length = wp.sqrt(dx_ * dx_ + dz_ * dz_)
        if length < 1.0e-9:
            a = wp.randf(rng) * 6.2831853
            dx_ = wp.cos(a)
            dz_ = wp.sin(a)
        else:
            dx_ = dx_ / length
            dz_ = dz_ / length
        nx = x + dx_
        nz = z + dz_
        if nx < 1.0 or nz < 1.0 or nx >= float(n - 3) or nz >= float(n - 3):
            break
        jx = int(nx)
        jz = int(nz)
        gfx = nx - float(jx)
        gfz = nz - float(jz)
        there = (
            h[jz, jx] * (1.0 - gfx) * (1.0 - gfz)
            + h[jz, jx + 1] * gfx * (1.0 - gfz)
            + h[jz + 1, jx] * (1.0 - gfx) * gfz
            + h[jz + 1, jx + 1] * gfx * gfz
        )
        # Heights and sediment in metres; slope (drop per step over its length) is unitless.
        dh = there - here
        slope = dh / dx
        e = erod[iz, ix]
        wp.atomic_add(flow, iz, ix, water)
        # Into the lake: everything it carries settles on the shelf (a delta), and it is done.
        if there < lake:
            amount = sed * e
            wp.atomic_add(h, iz, ix, amount * (1.0 - fx) * (1.0 - fz))
            wp.atomic_add(h, iz, ix + 1, amount * fx * (1.0 - fz))
            wp.atomic_add(h, iz + 1, ix, amount * (1.0 - fx) * fz)
            wp.atomic_add(h, iz + 1, ix + 1, amount * fx * fz)
            wp.atomic_add(dep, iz, ix, amount)
            break
        capacity = wp.max(-slope * speed * water * cap_k, cap_min)
        if sed > capacity or dh > 0.0:
            amount = (sed - capacity) * deposit_k
            if dh > 0.0:
                amount = wp.min(dh, sed)
            sed -= amount
            amount = amount * e
            wp.atomic_add(h, iz, ix, amount * (1.0 - fx) * (1.0 - fz))
            wp.atomic_add(h, iz, ix + 1, amount * fx * (1.0 - fz))
            wp.atomic_add(h, iz + 1, ix, amount * (1.0 - fx) * fz)
            wp.atomic_add(h, iz + 1, ix + 1, amount * fx * fz)
            wp.atomic_add(dep, iz, ix, amount)
        else:
            amount = wp.min((capacity - sed) * erode_k, -dh) * e
            # Spread the cut over a round brush so single cells never pit.
            total = float(0.0)
            for by in range(-radius, radius + 1):
                for bx in range(-radius, radius + 1):
                    ox = float(ix + bx) - x
                    oz = float(iz + by) - z
                    total += wp.max(0.0, rf - wp.sqrt(ox * ox + oz * oz))
            if total > 0.0:
                for by in range(-radius, radius + 1):
                    for bx in range(-radius, radius + 1):
                        cx = ix + bx
                        cz = iz + by
                        if cx >= 0 and cz >= 0 and cx < n and cz < n:
                            ox = float(cx) - x
                            oz = float(cz) - z
                            w = wp.max(0.0, rf - wp.sqrt(ox * ox + oz * oz)) / total
                            if w > 0.0:
                                take = amount * w * erod[cz, cx]
                                wp.atomic_add(h, cz, cx, -take)
                                wp.atomic_add(cut, cz, cx, take)
            sed += amount
        speed = wp.min(wp.sqrt(wp.max(0.0, speed * speed - slope * gravity)), 12.0)
        water = water * (1.0 - evaporate)
        x = nx
        z = nz


@wp.kernel
def talus(
    src: wp.array2d(dtype=float),
    dst: wp.array2d(dtype=float),
    erod: wp.array2d(dtype=float),
    rest: wp.array2d(dtype=float),
    n: int,
    dx: float,
    rate: float,
):
    j, i = wp.tid()
    if i < 1 or j < 1 or i >= n - 1 or j >= n - 1:
        dst[j, i] = src[j, i]
        return
    hc = src[j, i]
    change = float(0.0)
    for q in range(8):
        di = int(0)
        dj = int(0)
        if q == 0:
            di = -1
            dj = -1
        elif q == 1:
            di = 0
            dj = -1
        elif q == 2:
            di = 1
            dj = -1
        elif q == 3:
            di = -1
            dj = 0
        elif q == 4:
            di = 1
            dj = 0
        elif q == 5:
            di = -1
            dj = 1
        elif q == 6:
            di = 0
            dj = 1
        else:
            di = 1
            dj = 1
        d = dx
        if di != 0 and dj != 0:
            d = dx * 1.41421356
        hn = src[j + dj, i + di]
        # Symmetric exchange: what leaves one cell arrives at the other (mass is kept).
        limit = 0.5 * (rest[j, i] + rest[j + dj, i + di]) * d
        diff = hn - hc
        mobile = 0.5 * (erod[j, i] + erod[j + dj, i + di])
        if diff > limit:
            change += (diff - limit) * rate * mobile
        elif diff < -limit:
            change += (diff + limit) * rate * mobile
    dst[j, i] = hc + change


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def hillshade(h: np.ndarray, dx: float, sun, size=1024) -> Image.Image:
    step = max(1, h.shape[0] // size)
    s = h[::step, ::step].astype(np.float64)
    gz, gx = np.gradient(s, dx * step)
    nl = np.sqrt(gx * gx + gz * gz + 1)
    lit = np.clip((-gx * sun[0] + sun[1] - gz * sun[2]) / nl, 0, 1)
    shade = 0.28 / nl + 0.9 * lit
    t = np.clip((s + 60) / 1300, 0, 1)
    r = (0.42 + 0.45 * t) * shade
    g = (0.5 + 0.3 * t) * shade
    b = (0.34 + 0.55 * t) * shade
    img = np.stack([r, g, b], -1)
    return Image.fromarray((np.sqrt(np.clip(img, 0, 1)) * 255).astype(np.uint8))


def run_domain(name: str, work: Path, meta: dict, args, gov: Governor, sun) -> dict:
    d = meta["domains"][name]
    n = int(d["n"])
    dx = float(d["dx"])
    h = np.fromfile(work / f"{name}_h.f32", dtype=np.float32).reshape(n, n)
    erod = np.fromfile(work / f"{name}_erod.f32", dtype=np.float32).reshape(n, n)
    before = h.copy()
    # Fade erosion toward the grid's edge (it must keep meeting the outer grid there), and never
    # touch the lake bed.
    edge = np.minimum.outer(np.minimum(np.arange(n), n - 1 - np.arange(n)), np.minimum(np.arange(n), n - 1 - np.arange(n)))
    fade = smoothstep(8, 64, edge.astype(np.float32))
    mask = (erod * fade).astype(np.float32)
    mask[h < LAKE_LEVEL] = 0.0

    count = int(args.droplets * 1e6 * (1.0 if name == "inner" else 0.5))
    batch = 1 << 20
    dev = "cuda:0"
    H = wp.array(h, dtype=float, device=dev)
    E = wp.array(mask, dtype=float, device=dev)
    F = wp.zeros((n, n), dtype=float, device=dev)
    D = wp.zeros((n, n), dtype=float, device=dev)
    C = wp.zeros((n, n), dtype=float, device=dev)
    t0 = time.time()
    done = 0
    k = 0
    while done < count:
        m = min(batch, count - done)
        wp.launch(
            rain,
            dim=m,
            inputs=[
                H, E, F, D, C, n, 1000 + k, args.lifetime, dx,
                0.1,  # inertia
                args.capacity,  # metres of sediment per unit slope·speed·water
                0.0005,  # minimum capacity (m)
                args.erode,  # erode speed
                0.25,  # deposit speed
                0.012,  # evaporation per step
                4.0,  # gravity
                3 if name == "inner" else 2,  # brush radius (cells)
                LAKE_LEVEL,
            ],
            device=dev,
        )
        wp.synchronize_device(dev)
        gov.pace()
        done += m
        k += 1
        if k % 8 == 0 or done >= count:
            el = time.time() - t0
            print(f"  {name}: {done / 1e6:.1f} M droplets, {el:.0f} s", flush=True)

    # Talus: only the steepest faces shed (42–54°, varying across the rock); cliffs above that
    # crumble to their foot, while ordinary alpine slopes keep their shape.
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    wx = d["cx"] - d["size"] / 2 + (xx + 0.5) * dx
    wz = d["cz"] - d["size"] / 2 + (yy + 0.5) * dx
    var = np.sin(wx / 97.0 + np.sin(wz / 61.0) * 1.7) * np.cos(wz / 83.0 - np.sin(wx / 71.0) * 1.3)
    rest = np.tan(np.radians(48.0 + 6.0 * var)).astype(np.float32)
    R = wp.array(rest, dtype=float, device=dev)
    B = wp.empty_like(H)
    for it in range(args.talus):
        wp.launch(talus, dim=(n, n), inputs=[H, B, E, R, n, dx, 0.05], device=dev)
        H, B = B, H
        if it % 20 == 19:
            wp.synchronize_device(dev)
            gov.pace()
    wp.synchronize_device(dev)
    out = H.numpy()
    flow = F.numpy()
    dep = D.numpy()
    cut = C.numpy()
    out.astype(np.float32).tofile(work / f"{name}_h2.f32")
    flow.astype(np.float32).tofile(work / f"{name}_flow.f32")
    dep.astype(np.float32).tofile(work / f"{name}_dep.f32")
    cut.astype(np.float32).tofile(work / f"{name}_cut.f32")
    diff = out - before
    a = hillshade(before, dx, sun, 768)
    b = hillshade(out, dx, sun, 768)
    sheet = Image.new("RGB", (a.width * 2, a.height))
    sheet.paste(a, (0, 0))
    sheet.paste(b, (a.width, 0))
    sheet.save(work / f"{name}_droplets.jpg", quality=86)
    stats = {
        "droplets": count,
        "seconds": round(time.time() - t0, 1),
        "lowered_max_m": float(-diff.min()),
        "raised_max_m": float(diff.max()),
        "mean_abs_change_m": float(np.abs(diff).mean()),
    }
    print(f"  {name}: {stats}", flush=True)
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--droplets", type=float, default=40.0, help="millions, for the inner grid")
    ap.add_argument("--lifetime", type=int, default=80)
    ap.add_argument("--capacity", type=float, default=0.05)
    ap.add_argument("--erode", type=float, default=0.3)
    ap.add_argument("--talus", type=int, default=120)
    ap.add_argument("--domains", default="inner,outer")
    args = ap.parse_args()
    work = ROOT / "bake" / "work" / ("quick" if args.quick else "")
    meta = json.loads((work / "streampower.json").read_text())
    sun = meta["sun"]
    wp.init()
    gov = Governor(ROOT / "bake" / "work" / "thermal.csv", "erode_gpu")
    result = {"created": time.strftime("%Y-%m-%dT%H:%M:%S"), "args": vars(args), "domains": {}}
    for name in args.domains.split(","):
        print(f"{name}: droplets and talus", flush=True)
        result["domains"][name] = run_domain(name, work, meta, args, gov, sun)
    result["thermal"] = gov.summary()
    print(gov.summary(), flush=True)
    gov.close()
    (work / "erode_gpu.json").write_text(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
