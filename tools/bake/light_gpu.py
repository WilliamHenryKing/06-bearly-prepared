"""Landscape bake, stage B (GPU, CUDA via NVIDIA Warp): what the land is made of, and its light.

Materials from the erosion record (stage A): meadow that is lush where water gathers and dry on
sunny convex ground; conifer forest below a ragged tree line, denser on shaded slopes; bare rock
on steep faces and ridges; scree fans below them; gravel and water in the big channels; snow
above the snow line, lower on north faces and in gullies. Forests carry a canopy (crowns up to
~24 m) that casts shadows and catches light.

Light, per texel of both grids (the inner 2 m grid and the outer 8 m grid):
- the sun: its 0.53° disc sampled for soft penumbrae, occluded by terrain and canopy out to the
  horizon, and dimmed by the same cumulus that the sky panorama shows (cloud shadows);
- the sky: a cosine-weighted hemisphere gather (thousands of rays) against the path-traced sky
  panorama, with one bounce of light off the slopes that rays hit;
- everything in the game's own units (pre-exposed cd/m²), so it composes with the live scene.

Outputs (bake/work/): <grid>_albedo.f32, <grid>_radiance.f32 (RGB), <grid>_canopy.f32,
<grid>_mat.f32 (grass, rock, forest, snow weights), and preview images, including a ray-marched
view from the lookout.

Run: tools/bake/.venv/Scripts/python.exe tools/bake/light_gpu.py [--quick] [--sky-rays=4096]
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
from render_sky import CAMERA, EL_BOTTOM, neutral  # noqa: E402

LAKE_LEVEL = -54.0
LAKE = (-470.0, 330.0, 260.0, 150.0)
PI = math.pi


@wp.struct
class Grid:
    h: wp.array2d(dtype=float)
    top: wp.array2d(dtype=float)
    alb: wp.array2d(dtype=wp.vec3)
    direct: wp.array2d(dtype=wp.vec3)
    sky: wp.array2d(dtype=wp.vec3)
    x0: float
    z0: float
    dx: float
    n: int


@wp.func
def bil(a: wp.array2d(dtype=float), u: float, v: float) -> float:
    i = int(u)
    j = int(v)
    fu = u - float(i)
    fv = v - float(j)
    return wp.lerp(wp.lerp(a[j, i], a[j, i + 1], fu), wp.lerp(a[j + 1, i], a[j + 1, i + 1], fu), fv)


@wp.func
def bil3(a: wp.array2d(dtype=wp.vec3), u: float, v: float) -> wp.vec3:
    i = int(u)
    j = int(v)
    fu = u - float(i)
    fv = v - float(j)
    return wp.lerp(wp.lerp(a[j, i], a[j, i + 1], fu), wp.lerp(a[j + 1, i], a[j + 1, i + 1], fu), fv)


@wp.func
def local(g: Grid, x: float, z: float) -> wp.vec2:
    return wp.vec2((x - g.x0) / g.dx - 0.5, (z - g.z0) / g.dx - 0.5)


@wp.func
def inside(g: Grid, uv: wp.vec2) -> int:
    lim = float(g.n - 1)
    if uv[0] >= 0.0 and uv[1] >= 0.0 and uv[0] < lim and uv[1] < lim:
        return 1
    return 0


@wp.func
def top_at(a: Grid, b: Grid, x: float, z: float) -> wp.vec2:
    """Height of terrain + canopy at (x, z), and the grid spacing there (−1e4 outside)."""
    ua = local(a, x, z)
    if inside(a, ua) == 1:
        return wp.vec2(bil(a.top, ua[0], ua[1]), a.dx)
    ub = local(b, x, z)
    if inside(b, ub) == 1:
        return wp.vec2(bil(b.top, ub[0], ub[1]), b.dx)
    return wp.vec2(-1.0e4, 50.0)


@wp.func
def march(a: Grid, b: Grid, o: wp.vec3, d: wp.vec3, hmax: float, max_t: float) -> float:
    """Distance to the first hit of terrain or canopy, or −1 if the ray escapes."""
    t = float(0.3)
    while t < max_t:
        p = o + d * t
        if p[1] > hmax and d[1] >= 0.0:
            return -1.0
        s = top_at(a, b, p[0], p[2])
        if s[0] < -9000.0:
            return -1.0
        gap = p[1] - s[0]
        if gap < 0.0:
            return t
        t += wp.min(wp.max(gap * 0.45, s[1] * 0.5), 30.0 + t * 0.015)
    return -1.0


@wp.func
def env_at(env: wp.array2d(dtype=wp.vec3), d: wp.vec3, el_bottom: float) -> wp.vec3:
    h = env.shape[0]
    w = env.shape[1]
    phi = wp.atan2(d[2], d[0])
    if phi < 0.0:
        phi += 6.2831853
    el = wp.max(wp.asin(wp.clamp(d[1], -1.0, 1.0)), el_bottom)
    x = phi / 6.2831853 * float(w) - 0.5
    y = (1.5707963 - el) / (1.5707963 - el_bottom) * float(h) - 0.5
    ix = int(wp.floor(x))
    iy = int(wp.floor(y))
    fx = x - float(ix)
    fy = y - float(iy)
    x0 = clouds.wrap(ix, w)
    x1 = clouds.wrap(ix + 1, w)
    y0 = wp.clamp(iy, 0, h - 1)
    y1 = wp.clamp(iy + 1, 0, h - 1)
    return wp.lerp(wp.lerp(env[y0, x0], env[y0, x1], fx), wp.lerp(env[y1, x0], env[y1, x1], fx), fy)


@wp.func
def normal_at(g: Grid, i: int, j: int) -> wp.vec3:
    i0 = wp.max(i - 1, 0)
    i1 = wp.min(i + 1, g.n - 1)
    j0 = wp.max(j - 1, 0)
    j1 = wp.min(j + 1, g.n - 1)
    gx = (g.top[j, i1] - g.top[j, i0]) / (float(i1 - i0) * g.dx)
    gz = (g.top[j1, i] - g.top[j0, i]) / (float(j1 - j0) * g.dx)
    return wp.normalize(wp.vec3(-gx, 1.0, -gz))


@wp.func
def frame_dir(n: wp.vec3, u1: float, u2: float) -> wp.vec3:
    """Cosine-weighted direction about n."""
    r = wp.sqrt(u1)
    phi = 6.2831853 * u2
    x = r * wp.cos(phi)
    y = r * wp.sin(phi)
    z = wp.sqrt(wp.max(0.0, 1.0 - u1))
    a = wp.vec3(1.0, 0.0, 0.0)
    if wp.abs(n[0]) > 0.9:
        a = wp.vec3(0.0, 0.0, 1.0)
    t = wp.normalize(wp.cross(n, a))
    b = wp.cross(n, t)
    return wp.normalize(t * x + b * y + n * z)


# ---- Materials ---------------------------------------------------------------------------------


@wp.func
def n2(x: float, z: float, seed: int) -> float:
    return clouds.noise2(x, z, seed)


@wp.func
def f2(x: float, z: float, seed: int) -> float:
    return clouds.fbm2(x, z, seed)


@wp.kernel
def materials(
    h: wp.array2d(dtype=float),
    flow: wp.array2d(dtype=float),
    dep: wp.array2d(dtype=float),
    area: wp.array2d(dtype=float),
    erod: wp.array2d(dtype=float),
    x0: float,
    z0: float,
    dx: float,
    n: int,
    sun: wp.vec3,
    meadow: wp.vec3,
    alb: wp.array2d(dtype=wp.vec3),
    canopy: wp.array2d(dtype=float),
    mat: wp.array2d(dtype=wp.vec4),
    water: wp.array2d(dtype=float),
):
    j, i = wp.tid()
    x = x0 + (float(i) + 0.5) * dx
    z = z0 + (float(j) + 0.5) * dx
    i0 = wp.max(i - 1, 0)
    i1 = wp.min(i + 1, n - 1)
    j0 = wp.max(j - 1, 0)
    j1 = wp.min(j + 1, n - 1)
    gx = (h[j, i1] - h[j, i0]) / (float(i1 - i0) * dx)
    gz = (h[j1, i] - h[j0, i]) / (float(j1 - j0) * dx)
    nrm = wp.normalize(wp.vec3(-gx, 1.0, -gz))
    slope = wp.acos(wp.clamp(nrm[1], -1.0, 1.0))
    # Curvature over ~3 cells: convex ridges (>0) shed soil; hollows gather it.
    k = int(wp.max(1.0, 6.0 / dx))
    ia = wp.max(i - k, 0)
    ib = wp.min(i + k, n - 1)
    ja = wp.max(j - k, 0)
    jb = wp.min(j + k, n - 1)
    conv = (h[j, i] - 0.25 * (h[j, ia] + h[j, ib] + h[ja, i] + h[jb, i])) / (float(k) * dx)
    hv = h[j, i]
    north = -nrm[2] / wp.max(wp.sqrt(nrm[0] * nrm[0] + nrm[2] * nrm[2]), 1.0e-4) * wp.min(1.0, slope * 3.0)
    sunny = (nrm[0] * sun[0] + nrm[2] * sun[2]) / wp.max(wp.sqrt(sun[0] * sun[0] + sun[2] * sun[2]), 1.0e-4)
    wet = wp.clamp(wp.log(1.0 + flow[j, i]) / 7.0, 0.0, 1.0)
    a = area[j, i]
    big = wp.smoothstep(2.0e6, 9.0e6, a)
    stream = wp.smoothstep(2.5e5, 1.5e6, a)
    fan = wp.clamp(dep[j, i] / 3.0, 0.0, 1.0)
    e1 = f2(x / 45.0, z / 45.0, 7)
    e2 = f2(x / 170.0, z / 170.0, 8)
    e3 = f2(x / 700.0, z / 700.0, 9)
    crown = n2(x / 4.5, z / 4.5, 10)

    treeline = 700.0 + 110.0 * e3 + 60.0 * e2 + 45.0 * sunny
    snowline = 1060.0 + 90.0 * e3 + 40.0 * e2 - 150.0 * north - 70.0 * wp.clamp(-conv * 8.0, 0.0, 1.0)

    rock = wp.smoothstep(0.74, 0.98, slope + 0.1 * e1 + wp.clamp(conv * 3.0, 0.0, 0.25))
    rock = wp.max(rock, wp.smoothstep(treeline + 180.0, treeline + 420.0, hv) * wp.smoothstep(0.35, 0.6, slope))
    scree = wp.smoothstep(0.3, 0.8, fan + 0.3 * e2) * wp.smoothstep(0.35, 0.55, slope) * (1.0 - wp.smoothstep(0.8, 0.95, slope))
    scree = scree * wp.smoothstep(260.0, 480.0, hv) * 0.8
    snow = wp.smoothstep(snowline - 50.0, snowline + 70.0, hv) * (1.0 - wp.smoothstep(0.85, 1.15, slope))
    forest = (1.0 - wp.smoothstep(treeline - 60.0, treeline + 30.0, hv)) * (1.0 - wp.smoothstep(0.72, 0.9, slope))
    forest = forest * wp.smoothstep(-0.12, 0.22, e2 + 0.45 * e3 + 0.25 * north + 0.2 * wet - 0.05)
    forest = forest * (1.0 - rock) * (1.0 - big) * (1.0 - 0.8 * scree)
    forest = forest * wp.smoothstep(0.5, 0.95, erod[j, i])
    lake_e = wp.sqrt(((x - LAKE_X) / LAKE_RX) ** 2.0 + ((z - LAKE_Z) / LAKE_RZ) ** 2.0)
    forest = forest * wp.smoothstep(1.08, 1.3, lake_e)

    # Meadow: lush where water gathers, drier on sunny convex ground and up high.
    dry = wp.clamp(0.45 + 0.35 * sunny + 1.8 * conv - 0.8 * wet + 0.35 * e1 + wp.smoothstep(300.0, 900.0, hv) * 0.3, 0.0, 1.0)
    lush = wp.vec3(0.036, 0.060, 0.020)
    col = wp.lerp(lush, wp.vec3(0.092, 0.094, 0.046), dry)
    # Around the trail the far land wears the game's own turf colour, so it meets the live ground
    # (a 250 m square) without a seam, and hands over to the valley's own meadows further out.
    near = wp.sqrt((x - NEAR_X) * (x - NEAR_X) + (z - NEAR_Z) * (z - NEAR_Z))
    col = wp.lerp(meadow * (0.92 + 0.16 * e1), col, wp.smoothstep(260.0, 620.0, near))
    alpine = wp.vec3(0.072, 0.088, 0.044) * (0.85 + 0.3 * e1)
    col = wp.lerp(col, alpine, wp.smoothstep(treeline - 40.0, treeline + 160.0, hv))
    spruce = wp.vec3(0.021, 0.036, 0.017)
    larch = wp.vec3(0.040, 0.058, 0.022)
    canopy_col = wp.lerp(spruce, larch, wp.clamp(0.3 + 0.8 * e1, 0.0, 1.0)) * (0.62 + 0.6 * wp.clamp(crown * 0.9 + 0.5, 0.0, 1.0))
    col = wp.lerp(col, canopy_col, forest)
    strata = 0.8 + 0.3 * n2(x / 90.0, hv / 7.0, 11) + 0.15 * e1
    rock_col = wp.vec3(0.21, 0.198, 0.178) * strata
    rock_col = wp.lerp(rock_col, rock_col * 0.55, wet * 0.6)
    col = wp.lerp(col, wp.vec3(0.25, 0.24, 0.215) * (0.9 + 0.2 * e1), scree)
    col = wp.lerp(col, rock_col, rock)
    gravel = wp.vec3(0.22, 0.21, 0.185)
    col = wp.lerp(col, gravel, stream * wp.smoothstep(0.3, 0.05, slope) * 0.7)
    river = big * wp.smoothstep(0.25, 0.05, slope)
    col = wp.lerp(col, wp.vec3(0.07, 0.10, 0.11), river * 0.85)
    col = wp.lerp(col, wp.vec3(0.8, 0.82, 0.85) * (0.94 + 0.08 * e1), snow)
    if hv < LAKE_LEVEL + 0.4 and lake_e < 1.25:
        col = wp.vec3(0.05, 0.055, 0.05)
    alb[j, i] = col
    canopy[j, i] = forest * (15.0 + 7.0 * e1 + 3.0 * crown)
    mat[j, i] = wp.vec4(wp.max(0.0, 1.0 - rock - forest - snow), rock, forest, snow)
    water[j, i] = wp.max(river, 0.0)


NEAR_X = wp.constant(-73.0)
NEAR_Z = wp.constant(27.0)
LAKE_X = wp.constant(LAKE[0])
LAKE_Z = wp.constant(LAKE[1])
LAKE_RX = wp.constant(LAKE[2])
LAKE_RZ = wp.constant(LAKE[3])


# ---- Light ---------------------------------------------------------------------------------------


@wp.kernel
def light_direct(
    g: Grid,
    a: Grid,
    b: Grid,
    skip: Grid,
    use_skip: int,
    sun: wp.vec3,
    sun_irr: wp.vec3,
    disc: int,
    sky_rays: int,
    env: wp.array2d(dtype=wp.vec3),
    el_bottom: float,
    hmax: float,
    cam: wp.vec3,
    wm: wp.array2d(dtype=wp.vec2),
    shape: wp.array4d(dtype=float),
    detail: wp.array3d(dtype=float),
    row0: int,
    out_direct: wp.array2d(dtype=wp.vec3),
    out_sky: wp.array2d(dtype=wp.vec3),
):
    jj, i = wp.tid()
    j = jj + row0
    if j >= g.n:
        return
    x = g.x0 + (float(i) + 0.5) * g.dx
    z = g.z0 + (float(j) + 0.5) * g.dx
    if use_skip == 1:
        uv = local(skip, x, z)
        m = 40.0 / skip.dx
        if uv[0] > m and uv[1] > m and uv[0] < float(skip.n) - m and uv[1] < float(skip.n) - m:
            return
    nrm = normal_at(g, i, j)
    o = wp.vec3(x, g.top[j, i] + 0.4, z) + nrm * 0.3
    s = clouds.pcg(wp.uint32(j * g.n + i) ^ wp.uint32(0x9E3779B9))
    # The sun's disc, stratified.
    lit = float(0.0)
    ndl = wp.dot(nrm, sun)
    if ndl > 0.0:
        for k in range(disc):
            s = clouds.pcg(s)
            u = (float(k) + clouds.unit(s)) / float(disc)
            s = clouds.pcg(s)
            d = clouds.around(sun, 1.0 - u * (1.0 - 0.99998918), clouds.unit(s) * 6.2831853)
            if march(a, b, o, d, hmax, 12000.0) < 0.0:
                lit += 1.0
        lit = lit / float(disc)
    shade = float(1.0)
    if lit > 0.0:
        shade = clouds.sun_through(o, sun, cam, wm, shape, detail, 30.0)
    out_direct[j, i] = sun_irr * (wp.max(ndl, 0.0) * lit * shade)
    # A first, bounce-free sky estimate (the bounce pass reads it at the points it hits).
    e = wp.vec3(0.0)
    for k in range(sky_rays):
        s = clouds.pcg(s)
        u1 = (float(k) + clouds.unit(s)) / float(sky_rays)
        s = clouds.pcg(s)
        d = frame_dir(nrm, u1, clouds.unit(s))
        if march(a, b, o, d, hmax, 9000.0) < 0.0:
            e = e + env_at(env, d, el_bottom)
    out_sky[j, i] = e * (3.14159265 / float(sky_rays))


@wp.func
def bounce(a: Grid, b: Grid, p: wp.vec3) -> wp.vec3:
    """Radiance leaving the land at p toward the gatherer: albedo/π × (sun + sky)."""
    ua = local(a, p[0], p[2])
    if inside(a, ua) == 1:
        return wp.cw_mul(bil3(a.alb, ua[0], ua[1]), bil3(a.direct, ua[0], ua[1]) + bil3(a.sky, ua[0], ua[1])) * 0.31830989
    ub = local(b, p[0], p[2])
    if inside(b, ub) == 1:
        return wp.cw_mul(bil3(b.alb, ub[0], ub[1]), bil3(b.direct, ub[0], ub[1]) + bil3(b.sky, ub[0], ub[1])) * 0.31830989
    return wp.vec3(0.0)


@wp.kernel
def light_sky(
    g: Grid,
    a: Grid,
    b: Grid,
    skip: Grid,
    use_skip: int,
    rays: int,
    env: wp.array2d(dtype=wp.vec3),
    el_bottom: float,
    hmax: float,
    row0: int,
    seed: int,
    out: wp.array2d(dtype=wp.vec3),
):
    jj, i = wp.tid()
    j = jj + row0
    if j >= g.n:
        return
    x = g.x0 + (float(i) + 0.5) * g.dx
    z = g.z0 + (float(j) + 0.5) * g.dx
    if use_skip == 1:
        uv = local(skip, x, z)
        m = 40.0 / skip.dx
        if uv[0] > m and uv[1] > m and uv[0] < float(skip.n) - m and uv[1] < float(skip.n) - m:
            return
    nrm = normal_at(g, i, j)
    o = wp.vec3(x, g.top[j, i] + 0.4, z) + nrm * 0.3
    s = clouds.pcg(wp.uint32(j * g.n + i) ^ clouds.pcg(wp.uint32(seed)))
    e = wp.vec3(0.0)
    for k in range(rays):
        s = clouds.pcg(s)
        u1 = (float(k) + clouds.unit(s)) / float(rays)
        s = clouds.pcg(s)
        d = frame_dir(nrm, u1, clouds.unit(s))
        t = march(a, b, o, d, hmax, 9000.0)
        if t < 0.0:
            e = e + env_at(env, d, el_bottom)
        else:
            e = e + bounce(a, b, o + d * t)
    out[j, i] = out[j, i] + e * (3.14159265 / float(rays))


# ---- A view from the lookout (preview only) --------------------------------------------------


@wp.kernel
def view(
    a: Grid,
    b: Grid,
    rad_a: wp.array2d(dtype=wp.vec3),
    rad_b: wp.array2d(dtype=wp.vec3),
    env: wp.array2d(dtype=wp.vec3),
    el_bottom: float,
    hmax: float,
    eye: wp.vec3,
    fwd: wp.vec3,
    right: wp.vec3,
    up: wp.vec3,
    tan_half: float,
    w: int,
    h: int,
    fog_rgb: wp.vec3,
    fog_density: float,
    fog_scale: float,
    out: wp.array2d(dtype=wp.vec3),
):
    y, x = wp.tid()
    sx = ((float(x) + 0.5) / float(w) * 2.0 - 1.0) * tan_half * float(w) / float(h)
    sy = (1.0 - (float(y) + 0.5) / float(h) * 2.0) * tan_half
    d = wp.normalize(fwd + right * sx + up * sy)
    t = march(a, b, eye, d, hmax, 12000.0)
    if t < 0.0:
        out[y, x] = env_at(env, d, el_bottom)
        return
    p = eye + d * t
    col = wp.vec3(0.0)
    ua = local(a, p[0], p[2])
    if inside(a, ua) == 1:
        col = bil3(rad_a, ua[0], ua[1])
    else:
        ub = local(b, p[0], p[2])
        col = bil3(rad_b, ub[0], ub[1])
    # The game's haze (stage.ts): exponential, thinning with height.
    dh = p[1] - eye[1]
    avg = wp.exp(-wp.max(eye[1], 0.0) / fog_scale)
    if wp.abs(dh) > 1.0:
        avg = fog_scale * (wp.exp(-wp.max(eye[1], 0.0) / fog_scale) - wp.exp(-wp.max(p[1], 0.0) / fog_scale)) / dh
    f = 1.0 - wp.exp(-fog_density * t * avg)
    out[y, x] = wp.lerp(col, fog_rgb, f)


# ---- Driver ------------------------------------------------------------------------------------


def load(work: Path, name: str, n: int, suffix: str) -> np.ndarray:
    return np.fromfile(work / f"{name}_{suffix}.f32", dtype=np.float32).reshape(n, n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--disc", type=int, default=24)
    ap.add_argument("--sky-rays", type=int, default=4096)
    ap.add_argument("--first-rays", type=int, default=96)
    ap.add_argument("--coverage", type=float, default=0.5)
    args = ap.parse_args()
    work = ROOT / "bake" / "work" / ("quick" if args.quick else "")
    meta = json.loads((work / "streampower.json").read_text())
    sky = atmos.SKY
    sun = np.array(sky["sun"]["direction"], dtype=np.float64)
    pre = float(sky["preExposure"])
    sun_irr = np.array(sky["sunColour"]) * float(sky["sunLux"]) * pre

    wp.init()
    dev = "cuda:0"
    gov = Governor(ROOT / "bake" / "work" / "thermal.csv", "light")
    t0 = time.time()

    # The sky: the finished panorama if there is one, else a quick render of the same sky.
    sky_dir = ROOT / "bake" / "work"
    if args.quick or not (sky_dir / "sky_pano.json").exists():
        sky_dir = ROOT / "bake" / "work" / "quick"
    pm = json.loads((sky_dir / "sky_pano.json").read_text())
    pano = np.fromfile(sky_dir / "sky_pano.f32", dtype=np.float32).reshape(pm["height"], pm["width"], 4)
    f = max(1, pm["width"] // 1024)
    env_np = pano[: (pano.shape[0] // f) * f, : (pano.shape[1] // f) * f, :3]
    env_np = env_np.reshape(env_np.shape[0] // f, f, env_np.shape[1] // f, f, 3).mean(axis=(1, 3))
    print(f"sky light from {sky_dir.name}/sky_pano ({pm['width']}×{pm['height']}, {pm.get('spp')} spp)", flush=True)
    env = wp.array(np.ascontiguousarray(env_np, dtype=np.float32), dtype=wp.vec3, device=dev)
    shape, detail = clouds.build_volumes(dev)
    wm, _bounds = clouds.build_weather_map(args.coverage, dev)

    # The game's own turf, for the far land nearest the plateau (sRGB mean of its colour map).
    turf_path = ROOT / "public" / "textures" / "grass_ground" / "grass_ground_diff.webp"
    turf = Image.open(turf_path).convert("RGB") if turf_path.exists() else None
    if turf is not None:
        m = np.asarray(turf, dtype=np.float64).reshape(-1, 3).mean(axis=0) / 255
        meadow = np.where(m <= 0.04045, m / 12.92, ((m + 0.055) / 1.055) ** 2.4)
    else:
        meadow = np.array([0.06, 0.085, 0.03])

    grids = {}
    for name in ("inner", "outer"):
        d = meta["domains"][name]
        n = int(d["n"])
        dx = float(d["dx"])
        h2 = work / f"{name}_h2.f32"
        h = load(work, name, n, "h2" if h2.exists() else "h")
        flow = load(work, name, n, "flow") if (work / f"{name}_flow.f32").exists() else np.zeros_like(h)
        dep = load(work, name, n, "dep") if (work / f"{name}_dep.f32").exists() else np.zeros_like(h)
        area = load(work, name, n, "area")
        erod = load(work, name, n, "erod")
        x0 = d["cx"] - d["size"] / 2
        z0 = d["cz"] - d["size"] / 2
        H = wp.array(h, dtype=float, device=dev)
        alb = wp.zeros((n, n), dtype=wp.vec3, device=dev)
        can = wp.zeros((n, n), dtype=float, device=dev)
        mat = wp.zeros((n, n), dtype=wp.vec4, device=dev)
        water = wp.zeros((n, n), dtype=float, device=dev)
        wp.launch(
            materials,
            dim=(n, n),
            inputs=[
                H, wp.array(flow, dtype=float, device=dev), wp.array(dep, dtype=float, device=dev),
                wp.array(area, dtype=float, device=dev), wp.array(erod, dtype=float, device=dev),
                x0, z0, dx, n, wp.vec3(*sun), wp.vec3(*meadow), alb, can, mat, water,
            ],
            device=dev,
        )
        wp.synchronize_device(dev)
        g = Grid()
        g.h = H
        g.top = wp.array(h + can.numpy(), dtype=float, device=dev)
        g.alb = alb
        g.direct = wp.zeros((n, n), dtype=wp.vec3, device=dev)
        g.sky = wp.zeros((n, n), dtype=wp.vec3, device=dev)
        g.x0 = x0
        g.z0 = z0
        g.dx = dx
        g.n = n
        grids[name] = (g, can, mat, water, h)
        print(f"{name}: materials ({time.time() - t0:.0f} s)", flush=True)

    a = grids["inner"][0]
    b = grids["outer"][0]
    hmax = float(max(grids["inner"][4].max() + grids["inner"][1].numpy().max(), grids["outer"][4].max() + grids["outer"][1].numpy().max()) + 5)
    cam = wp.vec3(*CAMERA)
    el_b = float(EL_BOTTOM)

    def rows(g, fn, per=None):
        per = per or max(8, (1 << 16) // g.n)
        for r in range(0, g.n, per):
            fn(r, per)
            wp.synchronize_device(dev)
            gov.pace()

    # Pass 1: the sun (soft, cloud-shadowed) and a first sky estimate.
    for name, other_skip in (("inner", 0), ("outer", 1)):
        g = grids[name][0]
        rows(
            g,
            lambda r, per, g=g, other_skip=other_skip: wp.launch(
                light_direct,
                dim=(per, g.n),
                inputs=[g, a, b, a, other_skip, wp.vec3(*sun), wp.vec3(*sun_irr), args.disc, args.first_rays,
                        env, el_b, hmax, cam, wm, shape, detail, r, g.direct, g.sky],
                device=dev,
            ),
            per=max(4, (1 << 14) // g.n),
        )
        print(f"{name}: sun and first sky ({time.time() - t0:.0f} s)", flush=True)

    # Pass 2: the full sky gather with one bounce, in chunks of rays.
    final = {}
    chunk = 256
    for name, other_skip in (("inner", 0), ("outer", 1)):
        g = grids[name][0]
        acc = wp.zeros((g.n, g.n), dtype=wp.vec3, device=dev)
        passes = max(1, args.sky_rays // chunk)
        for p in range(passes):
            rows(
                g,
                lambda r, per, g=g, other_skip=other_skip, p=p: wp.launch(
                    light_sky,
                    dim=(per, g.n),
                    inputs=[g, a, b, a, other_skip, min(chunk, args.sky_rays), env, el_b, hmax, r, 7 + p * 131, acc],
                    device=dev,
                ),
                per=max(4, (1 << 15) // g.n),
            )
            if p % 4 == 3 or p == passes - 1:
                print(f"  {name}: sky {(p + 1) * chunk}/{args.sky_rays} rays ({time.time() - t0:.0f} s)", flush=True)
        sky_e = acc.numpy() / passes
        alb = g.alb.numpy()
        rad = alb / PI * (g.direct.numpy() + sky_e)
        final[name] = rad
        rad.astype(np.float32).tofile(work / f"{name}_radiance.f32")
        alb.astype(np.float32).tofile(work / f"{name}_albedo.f32")
        grids[name][1].numpy().astype(np.float32).tofile(work / f"{name}_canopy.f32")
        grids[name][2].numpy().astype(np.float32).tofile(work / f"{name}_mat.f32")
        grids[name][3].numpy().astype(np.float32).tofile(work / f"{name}_water.f32")
        (g.direct.numpy()).astype(np.float32).tofile(work / f"{name}_sun.f32")
        sky_e.astype(np.float32).tofile(work / f"{name}_sky.f32")
        step = max(1, g.n // 1024)
        Image.fromarray((neutral(rad[::step, ::step]) * 255).astype(np.uint8)).save(work / f"{name}_lit.jpg", quality=88)

    # A view from the lookout deck, down the valley toward the sun, with the game's haze.
    ra = wp.array(final["inner"].astype(np.float32), dtype=wp.vec3, device=dev)
    rb = wp.array(final["outer"].astype(np.float32), dtype=wp.vec3, device=dev)
    haze = np.array([0.74, 0.92, 1.32])
    horizon = env_np[int(env_np.shape[0] * (90 / (90 - EL_BOTTOM * 180 / PI))) - 2].mean(axis=0)
    fog = horizon * haze / haze.mean() * 0.9
    shots = {
        "valley": ((-146.0, 8.1, 72.9), (-0.86, -0.12, 0.49), 55),
        "ranges": ((-146.0, 8.1, 72.9), (-0.2, 0.02, -0.98), 55),
        "east": ((-40.0, 12.0, 20.0), (0.95, 0.05, 0.3), 55),
    }
    W, Hh = 1600, 900
    for label, (eye, fwd, fov) in shots.items():
        f_ = np.array(fwd) / np.linalg.norm(fwd)
        r_ = np.cross(f_, [0, 1, 0])
        r_ /= np.linalg.norm(r_)
        u_ = np.cross(r_, f_)
        out = wp.zeros((Hh, W), dtype=wp.vec3, device=dev)
        wp.launch(
            view,
            dim=(Hh, W),
            inputs=[a, b, ra, rb, env, el_b, hmax, wp.vec3(*eye), wp.vec3(*f_), wp.vec3(*r_), wp.vec3(*u_),
                    math.tan(math.radians(fov) / 2), W, Hh, wp.vec3(*fog), 3.912 / 17000, 900.0, out],
            device=dev,
        )
        wp.synchronize_device(dev)
        img = neutral(out.numpy())
        Image.fromarray((img * 255).astype(np.uint8)).save(work / f"view_{label}.jpg", quality=90)
    summary = {"seconds": round(time.time() - t0), "sky_rays": args.sky_rays, "disc": args.disc, "thermal": gov.summary()}
    (work / "light_gpu.json").write_text(json.dumps(summary, indent=2))
    print(gov.summary(), flush=True)
    gov.close()


if __name__ == "__main__":
    main()
