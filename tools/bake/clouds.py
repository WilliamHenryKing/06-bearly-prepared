"""The sky over the valley: a volumetric cumulus field, path traced (CUDA via NVIDIA Warp).

Fair-weather cumulus over the ranges. They're shaped Horizon-Zero-Dawn style (Schneider 2015):
a weather map says where cells form and how tall they grow, tileable Perlin-Worley billows give
them body, and a finer Worley field erodes their edges, wispy at the base and cauliflower at the
top. They are rendered as a participating medium, not faked:
- delta tracking samples real scattering events;
- the sun is sampled at every event (ratio-tracked shadow rays);
- the phase function is the approximate Mie fit for 20 µm droplets (Jendersie & d'Eon 2023,
  HG + Draine) with its sharp forward peak (silver linings) and back-scatter;
- paths that leave the layer collect the game's own atmosphere (atmos.py), and the ground below
  returns sunlit meadow;
- beyond eight events a path's free flights lengthen (a standard production approximation of deep
  multiple scattering), so cloud bases carry the light that diffuses through.
The camera ray itself is hazed by the atmosphere up to its first event.

The same density field casts the clouds' shadows on the land (light_gpu.py). World metres, y up,
+X east, -Z north, as in the game.
"""

from __future__ import annotations

import math

import numpy as np
import warp as wp

import atmos

BASE = wp.constant(2150.0)
TOP = wp.constant(4000.0)
SIGMA = wp.constant(0.09)  # extinction at density 1 (per metre): cumulus-thick
ALBEDO = wp.constant(0.9985)
SHAPE_TILE = wp.constant(5200.0)  # metres per repeat of the billow volume
DETAIL_TILE = wp.constant(900.0)
SHAPE_N = 128
DETAIL_N = 64
SHAPE_N_CONST = wp.constant(SHAPE_N)
DETAIL_N_CONST = wp.constant(DETAIL_N)
EARTH_R = wp.constant(6360000.0)
WEATHER_N = 4096
WEATHER_HALF = 122880.0  # metres: the weather map covers ±123 km around the valley
CIRRUS_Y = wp.constant(7600.0)
CIRRUS_H = wp.constant(260.0)
CIRRUS_SIGMA = wp.constant(0.0011)


# ---- Hashing and random numbers ------------------------------------------------------------


@wp.func
def pcg(v: wp.uint32) -> wp.uint32:
    s = v * wp.uint32(747796405) + wp.uint32(2891336453)
    w = ((s >> ((s >> wp.uint32(28)) + wp.uint32(4))) ^ s) * wp.uint32(277803737)
    return (w >> wp.uint32(22)) ^ w


@wp.func
def unit(h: wp.uint32) -> float:
    return float(h >> wp.uint32(8)) * (1.0 / 16777216.0)


@wp.func
def hash3(x: int, y: int, z: int, seed: int) -> wp.uint32:
    return pcg(pcg(pcg(wp.uint32(x) ^ wp.uint32(seed * 9781)) ^ wp.uint32(y)) ^ wp.uint32(z))


@wp.func
def wrap(i: int, p: int) -> int:
    r = i % p
    if r < 0:
        r += p
    return r


# ---- Tileable noise volumes (built once on the GPU) ----------------------------------------


@wp.func
def grad_dot(h: wp.uint32, x: float, y: float, z: float) -> float:
    k = int(h & wp.uint32(15))
    u = x
    if k >= 8:
        u = y
    v = y
    if k >= 4:
        v = z
        if k == 12 or k == 14:
            v = x
    su = u
    if (k & 1) != 0:
        su = -u
    sv = v
    if (k & 2) != 0:
        sv = -v
    return su + sv


@wp.func
def fade(t: float) -> float:
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


@wp.func
def perlin_tiled(p: wp.vec3, period: int, seed: int) -> float:
    ix = int(wp.floor(p[0]))
    iy = int(wp.floor(p[1]))
    iz = int(wp.floor(p[2]))
    fx = p[0] - float(ix)
    fy = p[1] - float(iy)
    fz = p[2] - float(iz)
    u = fade(fx)
    v = fade(fy)
    w = fade(fz)
    total = float(0.0)
    for c in range(8):
        dx = c & 1
        dy = (c >> 1) & 1
        dz = (c >> 2) & 1
        h = hash3(wrap(ix + dx, period), wrap(iy + dy, period), wrap(iz + dz, period), seed)
        g = grad_dot(h, fx - float(dx), fy - float(dy), fz - float(dz))
        wx = u
        if dx == 0:
            wx = 1.0 - u
        wy = v
        if dy == 0:
            wy = 1.0 - v
        wz = w
        if dz == 0:
            wz = 1.0 - w
        total += g * wx * wy * wz
    return total


@wp.func
def worley_tiled(p: wp.vec3, period: int, seed: int) -> float:
    """Distance to the nearest feature point (0 … ~1), tiling every `period` cells."""
    ix = int(wp.floor(p[0]))
    iy = int(wp.floor(p[1]))
    iz = int(wp.floor(p[2]))
    best = float(9.0)
    for c in range(27):
        dx = c % 3 - 1
        dy = (c // 3) % 3 - 1
        dz = c // 9 - 1
        cx = ix + dx
        cy = iy + dy
        cz = iz + dz
        h = hash3(wrap(cx, period), wrap(cy, period), wrap(cz, period), seed)
        h2 = pcg(h)
        h3 = pcg(h2)
        f = wp.vec3(float(cx) + unit(h), float(cy) + unit(h2), float(cz) + unit(h3))
        best = wp.min(best, wp.length(f - p))
    return wp.min(best, 1.0)


@wp.func
def remap(v: float, a: float, b: float, c: float, d: float) -> float:
    return c + (v - a) / (b - a) * (d - c)


@wp.kernel
def build_shape(vol: wp.array4d(dtype=float), n: int):
    i, j, k = wp.tid()
    p = wp.vec3(float(i) + 0.5, float(j) + 0.5, float(k) + 0.5) / float(n)
    # Perlin fbm, 4 octaves, tiling.
    pf = float(0.0)
    amp = float(1.0)
    norm = float(0.0)
    for o in range(4):
        f = 4 << o
        pf += amp * perlin_tiled(p * float(f), f, 11 + o)
        norm += amp
        amp *= 0.5
    pf = pf / norm * 0.5 + 0.5
    # Worley fbm (inverted: billows), 3 octaves.
    w1 = 1.0 - worley_tiled(p * 6.0, 6, 21)
    w2 = 1.0 - worley_tiled(p * 12.0, 12, 22)
    w3 = 1.0 - worley_tiled(p * 24.0, 24, 23)
    wf = w1 * 0.625 + w2 * 0.25 + w3 * 0.125
    pw = wp.clamp(remap(pf, wf - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0)
    vol[k, j, i, 0] = pw
    vol[k, j, i, 1] = wf


@wp.kernel
def build_detail(vol: wp.array3d(dtype=float), n: int):
    i, j, k = wp.tid()
    p = wp.vec3(float(i) + 0.5, float(j) + 0.5, float(k) + 0.5) / float(n)
    w1 = 1.0 - worley_tiled(p * 4.0, 4, 31)
    w2 = 1.0 - worley_tiled(p * 8.0, 8, 32)
    w3 = 1.0 - worley_tiled(p * 16.0, 16, 33)
    vol[k, j, i] = w1 * 0.625 + w2 * 0.25 + w3 * 0.125


@wp.func
def sample4(vol: wp.array4d(dtype=float), n: int, p: wp.vec3, ch: int) -> float:
    x = p[0] * float(n) - 0.5
    y = p[1] * float(n) - 0.5
    z = p[2] * float(n) - 0.5
    ix = int(wp.floor(x))
    iy = int(wp.floor(y))
    iz = int(wp.floor(z))
    fx = x - float(ix)
    fy = y - float(iy)
    fz = z - float(iz)
    x0 = wrap(ix, n)
    x1 = wrap(ix + 1, n)
    y0 = wrap(iy, n)
    y1 = wrap(iy + 1, n)
    z0 = wrap(iz, n)
    z1 = wrap(iz + 1, n)
    a = wp.lerp(vol[z0, y0, x0, ch], vol[z0, y0, x1, ch], fx)
    b = wp.lerp(vol[z0, y1, x0, ch], vol[z0, y1, x1, ch], fx)
    c = wp.lerp(vol[z1, y0, x0, ch], vol[z1, y0, x1, ch], fx)
    d = wp.lerp(vol[z1, y1, x0, ch], vol[z1, y1, x1, ch], fx)
    return wp.lerp(wp.lerp(a, b, fy), wp.lerp(c, d, fy), fz)


@wp.func
def sample3(vol: wp.array3d(dtype=float), n: int, p: wp.vec3) -> float:
    x = p[0] * float(n) - 0.5
    y = p[1] * float(n) - 0.5
    z = p[2] * float(n) - 0.5
    ix = int(wp.floor(x))
    iy = int(wp.floor(y))
    iz = int(wp.floor(z))
    fx = x - float(ix)
    fy = y - float(iy)
    fz = z - float(iz)
    x0 = wrap(ix, n)
    x1 = wrap(ix + 1, n)
    y0 = wrap(iy, n)
    y1 = wrap(iy + 1, n)
    z0 = wrap(iz, n)
    z1 = wrap(iz + 1, n)
    a = wp.lerp(vol[z0, y0, x0], vol[z0, y0, x1], fx)
    b = wp.lerp(vol[z0, y1, x0], vol[z0, y1, x1], fx)
    c = wp.lerp(vol[z1, y0, x0], vol[z1, y0, x1], fx)
    d = wp.lerp(vol[z1, y1, x0], vol[z1, y1, x1], fx)
    return wp.lerp(wp.lerp(a, b, fy), wp.lerp(c, d, fy), fz)


# ---- The weather and the density field ------------------------------------------------------


@wp.func
def noise2(x: float, z: float, seed: int) -> float:
    return perlin_tiled(wp.vec3(x, 0.37, z), 1 << 20, seed)


@wp.func
def fbm2(x: float, z: float, seed: int) -> float:
    s = float(0.0)
    a = float(0.5)
    px = x
    pz = z
    for o in range(4):
        s += a * noise2(px, pz, seed + o)
        nx = 1.6 * px - 1.2 * pz
        pz = 1.2 * px + 1.6 * pz
        px = nx
        a *= 0.5
    return s


@wp.kernel
def build_weather(out: wp.array2d(dtype=wp.vec2), n: int, half: float, coverage: float):
    """Cell coverage (0 … 1) and how tall the cells grow (0 … 1), baked once."""
    j, i = wp.tid()
    x = -half + (float(i) + 0.5) / float(n) * 2.0 * half
    z = -half + (float(j) + 0.5) / float(n) * 2.0 * half
    c = fbm2(x / 7400.0 + 11.3, z / 7400.0 - 4.1, 101) * 1.1 + fbm2(x / 2300.0, z / 2300.0, 202) * 0.55
    cov = wp.clamp((c + 0.35 - (1.0 - coverage) * 0.72) * 2.4, 0.0, 1.0)
    tall = wp.clamp(fbm2(x / 5200.0 - 7.7, z / 5200.0 + 2.2, 303) * 1.4 + 0.45, 0.0, 1.0)
    out[j, i] = wp.vec2(cov, tall)


@wp.func
def weather(wm: wp.array2d(dtype=wp.vec2), x: float, z: float) -> wp.vec2:
    n = wm.shape[0]
    fx = (x + WEATHER_HALF_C) / (2.0 * WEATHER_HALF_C) * float(n) - 0.5
    fz = (z + WEATHER_HALF_C) / (2.0 * WEATHER_HALF_C) * float(n) - 0.5
    ix = int(wp.floor(fx))
    iz = int(wp.floor(fz))
    if ix < 0 or iz < 0 or ix >= n - 1 or iz >= n - 1:
        return wp.vec2(0.0, 0.0)
    tx = fx - float(ix)
    tz = fz - float(iz)
    a = wp.lerp(wm[iz, ix], wm[iz, ix + 1], tx)
    b = wp.lerp(wm[iz + 1, ix], wm[iz + 1, ix + 1], tx)
    return wp.lerp(a, b, tz)


WEATHER_HALF_C = wp.constant(WEATHER_HALF)
COARSE_N = 512  # divides WEATHER_N exactly: 8 weather texels (480 m) per coarse cell
COARSE_CELL = wp.constant(2.0 * WEATHER_HALF / 512.0)


@wp.kernel
def build_bounds(wm: wp.array2d(dtype=wp.vec2), out: wp.array2d(dtype=float), n: int, per: int):
    """Upper bound of coverage in each coarse cell and its neighbours (for empty-space skipping)."""
    j, i = wp.tid()
    m = float(0.0)
    for dj in range(-1, 2):
        for di in range(-1, 2):
            cj = j + dj
            ci = i + di
            if cj >= 0 and ci >= 0 and cj < n and ci < n:
                for y in range(per + 2):
                    for x in range(per + 2):
                        wy = wp.clamp(cj * per + y - 1, 0, wm.shape[0] - 1)
                        wx = wp.clamp(ci * per + x - 1, 0, wm.shape[1] - 1)
                        m = wp.max(m, wm[wy, wx][0])
    out[j, i] = m


@wp.func
def bound_at(bounds: wp.array2d(dtype=float), x: float, z: float) -> float:
    n = bounds.shape[0]
    i = int(wp.floor((x + WEATHER_HALF_C) / COARSE_CELL))
    j = int(wp.floor((z + WEATHER_HALF_C) / COARSE_CELL))
    if i < 0 or j < 0 or i >= n or j >= n:
        return 0.0
    return bounds[j, i]


@wp.func
def cell_exit(p: wp.vec3, d: wp.vec3) -> float:
    """Distance along d until p leaves its coarse cell (in x or z)."""
    cx = wp.floor((p[0] + WEATHER_HALF_C) / COARSE_CELL)
    cz = wp.floor((p[2] + WEATHER_HALF_C) / COARSE_CELL)
    tx = float(1.0e9)
    tz = float(1.0e9)
    if d[0] > 1.0e-7:
        tx = ((cx + 1.0) * COARSE_CELL - WEATHER_HALF_C - p[0]) / d[0]
    elif d[0] < -1.0e-7:
        tx = (cx * COARSE_CELL - WEATHER_HALF_C - p[0]) / d[0]
    if d[2] > 1.0e-7:
        tz = ((cz + 1.0) * COARSE_CELL - WEATHER_HALF_C - p[2]) / d[2]
    elif d[2] < -1.0e-7:
        tz = (cz * COARSE_CELL - WEATHER_HALF_C - p[2]) / d[2]
    return wp.max(wp.min(tx, tz), 0.0) + 0.05


@wp.func
def altitude(p: wp.vec3, cam: wp.vec3) -> float:
    """Height above the (curved) ground: far clouds sink toward the horizon."""
    dx = p[0] - cam[0]
    dz = p[2] - cam[2]
    return p[1] + (dx * dx + dz * dz) / (2.0 * EARTH_R)


@wp.func
def cumulus(
    p: wp.vec3,
    cam: wp.vec3,
    wm: wp.array2d(dtype=wp.vec2),
    shape: wp.array4d(dtype=float),
    detail: wp.array3d(dtype=float),
) -> float:
    """Density 0 … 1 of the cumulus layer at a world point."""
    y = altitude(p, cam)
    if y < BASE or y > TOP:
        return 0.0
    w = weather(wm, p[0], p[2])
    if w[0] <= 0.0:
        return 0.0
    top = BASE + 520.0 + 1300.0 * w[1]
    if y > top:
        return 0.0
    hf = (y - BASE) / (top - BASE)
    # Flat, crisp bases; domed tops that round off as the cell loses coverage.
    grad = wp.smoothstep(0.0, 0.06, hf) * (1.0 - wp.smoothstep(0.45, 1.0, hf))
    # Billows lean a little downwind with height.
    q = wp.vec3(p[0] + hf * 180.0, y, p[2] - hf * 90.0)
    b = sample4(shape, SHAPE_N_CONST, q / SHAPE_TILE, 0)
    lowf = sample4(shape, SHAPE_N_CONST, q / SHAPE_TILE, 1)
    body = remap(b, -(1.0 - lowf) * 0.6, 1.0, 0.0, 1.0)
    d = wp.clamp(remap(body * grad, 1.0 - w[0], 1.0, 0.0, 1.0), 0.0, 1.0) * w[0]
    if d <= 0.0:
        return 0.0
    det = sample3(detail, DETAIL_N_CONST, q / DETAIL_TILE)
    # Wispy (inverted) at the base, billowy at the top.
    mod = wp.lerp(1.0 - det, det, wp.clamp(hf * 3.0, 0.0, 1.0))
    d = wp.clamp(remap(d, mod * 0.32, 1.0, 0.0, 1.0), 0.0, 1.0)
    # Cumulus are dense right up to a crisp surface: saturate the interior.
    return wp.min(1.0, d * 2.4)


@wp.func
def cirrus(p: wp.vec3, cam: wp.vec3, detail: wp.array3d(dtype=float)) -> float:
    """A thin, streaky cirrus sheet high above (density 0 … 1)."""
    dy = wp.abs(altitude(p, cam) - CIRRUS_Y)
    if dy > CIRRUS_H:
        return 0.0
    band = 1.0 - wp.smoothstep(0.2, 1.0, dy / CIRRUS_H)
    s = fbm2(p[0] / 26000.0, p[2] / 3200.0, 404) + 0.5 * fbm2(p[0] / 9000.0 + 3.0, p[2] / 1300.0, 505)
    m = wp.clamp((s - 0.12) * 3.0, 0.0, 1.0)
    if m <= 0.0:
        return 0.0
    fine = sample3(detail, DETAIL_N_CONST, wp.vec3(p[0] / 5200.0, p[1] / 900.0, p[2] / 700.0))
    return band * m * wp.clamp(fine * 1.4 - 0.3, 0.0, 1.0)


# ---- Phase function: approximate Mie for cloud droplets --------------------------------------


def mie_params(d_um: float = 20.0):
    g_hg = math.exp(-0.0990567 / (d_um - 1.67154))
    g_d = math.exp(-2.20679 / (d_um + 3.91029) - 0.428934)
    alpha = math.exp(3.62489 - 8.29288 / (d_um + 5.52825))
    w_d = math.exp(-0.599085 / (d_um - 0.641583) - 0.665888)
    return g_hg, g_d, alpha, w_d


_G_HG, _G_D, _ALPHA, _W_D = mie_params(20.0)
G_HG = wp.constant(_G_HG)
G_D = wp.constant(_G_D)
ALPHA_D = wp.constant(_ALPHA)
W_D = wp.constant(_W_D)
INV_4PI = wp.constant(1.0 / (4.0 * math.pi))


@wp.func
def hg(mu: float, g: float) -> float:
    d = 1.0 + g * g - 2.0 * g * mu
    return INV_4PI * (1.0 - g * g) / (d * wp.sqrt(d))


@wp.func
def draine(mu: float, g: float, a: float) -> float:
    d = 1.0 + g * g - 2.0 * g * mu
    return INV_4PI * (1.0 - g * g) / (d * wp.sqrt(d)) * (1.0 + a * mu * mu) / (1.0 + a * (1.0 + 2.0 * g * g) / 3.0)


@wp.func
def phase(mu: float) -> float:
    return (1.0 - W_D) * hg(mu, G_HG) + W_D * draine(mu, G_D, ALPHA_D)


@wp.func
def sample_hg_mu(g: float, u: float) -> float:
    if wp.abs(g) < 1.0e-4:
        return 1.0 - 2.0 * u
    s = (1.0 - g * g) / (1.0 - g + 2.0 * g * u)
    return wp.clamp((1.0 + g * g - s * s) / (2.0 * g), -1.0, 1.0)


@wp.func
def around(w: wp.vec3, mu: float, phi: float) -> wp.vec3:
    """A unit vector at angle acos(mu) from w, turned phi about it."""
    sin_t = wp.sqrt(wp.max(0.0, 1.0 - mu * mu))
    a = wp.vec3(1.0, 0.0, 0.0)
    if wp.abs(w[0]) > 0.9:
        a = wp.vec3(0.0, 1.0, 0.0)
    t = wp.normalize(wp.cross(w, a))
    b = wp.cross(w, t)
    return wp.normalize(t * (sin_t * wp.cos(phi)) + b * (sin_t * wp.sin(phi)) + w * mu)


# ---- Sky light for paths that leave the layer ----------------------------------------------


@wp.kernel
def build_sky_lut(
    lut: wp.array2d(dtype=wp.vec3),
    w: int,
    h: int,
    sun: wp.vec3,
    lux: float,
    height: float,
    ground: wp.vec3,
):
    """Equirect radiance (cd/m²) seen from `height`: sky above; hazed sunlit ground below."""
    j, i = wp.tid()
    phi = (float(i) + 0.5) / float(w) * 6.2831853
    el = 1.5707963 - (float(j) + 0.5) / float(h) * 3.1415927
    d = wp.vec3(wp.cos(el) * wp.cos(phi), wp.sin(el), wp.cos(el) * wp.sin(phi))
    col = atmos.scatter(d, sun, lux, 1.0e12, height)
    if d[1] < 0.0:
        dist = (height + 20.0) / wp.max(-d[1], 1.0e-3)
        col = atmos.scatter(d, sun, lux, dist, height) + wp.cw_mul(atmos.transmittance(d, dist, height), ground)
    lut[j, i] = col


@wp.func
def sky_at(lut: wp.array2d(dtype=wp.vec3), d: wp.vec3) -> wp.vec3:
    h = lut.shape[0]
    w = lut.shape[1]
    phi = wp.atan2(d[2], d[0])
    if phi < 0.0:
        phi += 6.2831853
    el = wp.asin(wp.clamp(d[1], -1.0, 1.0))
    x = phi / 6.2831853 * float(w) - 0.5
    y = (1.5707963 - el) / 3.1415927 * float(h) - 0.5
    ix = int(wp.floor(x))
    iy = int(wp.floor(y))
    fx = x - float(ix)
    fy = y - float(iy)
    x0 = wrap(ix, w)
    x1 = wrap(ix + 1, w)
    y0 = wp.clamp(iy, 0, h - 1)
    y1 = wp.clamp(iy + 1, 0, h - 1)
    return wp.lerp(wp.lerp(lut[y0, x0], lut[y0, x1], fx), wp.lerp(lut[y1, x0], lut[y1, x1], fx), fy)


# ---- Tracking through the cumulus shell ------------------------------------------------------


@wp.func
def shell(o: wp.vec3, d: wp.vec3, cam: wp.vec3, lo: float, hi: float) -> wp.vec2:
    """Entry and exit distance of a ray through the spherical shell lo < altitude < hi (first
    segment only: rays from inside or below; good for everything this renders)."""
    c = wp.vec3(cam[0], -EARTH_R, cam[2])
    rel = o - c
    outer = atmos.sphere_hit(rel, d, EARTH_R + hi)
    inner = atmos.sphere_hit(rel, d, EARTH_R + lo)
    if outer[1] <= 0.0:
        return wp.vec2(1.0, -1.0)
    alt = wp.length(rel) - EARTH_R
    t0 = float(0.0)
    t1 = outer[1]
    if alt < lo:
        # Below the shell: enter where we cross its floor on the way out.
        if inner[1] <= 0.0:
            return wp.vec2(1.0, -1.0)
        t0 = inner[1]
    else:
        if alt > hi:
            if outer[0] <= 0.0:
                return wp.vec2(1.0, -1.0)
            t0 = outer[0]
        # Heading down from inside: leave through the floor if it is hit first.
        if inner[0] > t0:
            t1 = wp.min(t1, inner[0])
    return wp.vec2(t0, wp.min(t1, 2.0e5))


@wp.func
def sun_through(
    p: wp.vec3, sun: wp.vec3, cam: wp.vec3, wm: wp.array2d(dtype=wp.vec2),
    shape: wp.array4d(dtype=float), detail: wp.array3d(dtype=float), step: float,
) -> float:
    """Deterministic transmittance toward the sun through the cumulus (for the land's shadows)."""
    span = shell(p, sun, cam, BASE, TOP)
    if span[1] <= span[0]:
        return 1.0
    tau = float(0.0)
    t = span[0] + step * 0.5
    while t < span[1] and tau < 12.0:
        tau += cumulus(p + sun * t, cam, wm, shape, detail) * SIGMA * step
        t += step
    return wp.exp(-tau)


@wp.kernel
def render_pano(
    accum: wp.array2d(dtype=wp.vec4),
    accum2: wp.array2d(dtype=float),
    x0: int,
    y0: int,
    tw: int,
    th: int,
    width: int,
    height: int,
    el_top: float,
    el_bottom: float,
    cam: wp.vec3,
    sun: wp.vec3,
    sun_rgb: wp.vec3,
    lux: float,
    wm: wp.array2d(dtype=wp.vec2),
    bounds: wp.array2d(dtype=float),
    shape: wp.array4d(dtype=float),
    detail: wp.array3d(dtype=float),
    lut: wp.array2d(dtype=wp.vec3),
    sky_ambient: wp.vec3,
    ground: wp.vec3,
    sample: int,
    max_events: int,
    clamp: float,
    stretch_from: int,
    stretch_rate: float,
    stretch_floor: float,
):
    ty, tx = wp.tid()
    px = x0 + tx
    py = y0 + ty
    if tx >= tw or ty >= th or px >= width or py >= height:
        return
    s = pcg(wp.uint32(py * width + px) ^ pcg(wp.uint32(sample) * wp.uint32(2654435761)))
    s = pcg(s)
    jx = unit(s)
    s = pcg(s)
    jy = unit(s)
    phi = (float(px) + jx) / float(width) * 6.2831853
    el = el_top - (float(py) + jy) / float(height) * (el_top - el_bottom)
    d = wp.vec3(wp.cos(el) * wp.cos(phi), wp.sin(el), wp.cos(el) * wp.sin(phi))

    if d[1] < 0.0:
        # Below the horizon: land 12 km off, all but lost in haze (what the far ring fades into).
        dh = wp.normalize(wp.vec3(d[0], 0.004, d[2]))
        col = atmos.scatter(dh, sun, lux, 12000.0, 0.0) + wp.cw_mul(atmos.transmittance(dh, 12000.0, 0.0), ground)
        accum[py, px] = accum[py, px] + wp.vec4(col[0], col[1], col[2], 0.0)
        lum0 = 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2]
        accum2[py, px] = accum2[py, px] + lum0 * lum0
        return

    # Cumulus first, as if in vacuum; the atmosphere hazes the result up to the first event.
    radiance = wp.vec3(0.0)
    through = wp.vec3(1.0)
    first = float(-1.0)
    o = cam
    dir = d
    events = int(0)
    stretch = float(1.0)
    alive = int(1)
    while alive == 1:
        span = shell(o, dir, cam, BASE, TOP)
        if span[1] <= span[0]:
            if events > 0:
                radiance = radiance + wp.cw_mul(through, sky_at(lut, dir))
            alive = 0
            break
        # Delta tracking with a piecewise-constant majorant: each coarse cell bounds the density
        # inside it, so clear air is crossed in one leap and thin cloud in long strides.
        t = span[0]
        hit = int(0)
        guard = int(0)
        while hit == 0 and t < span[1] and guard < 4000:
            guard += 1
            here = o + dir * t
            majorant = bound_at(bounds, here[0], here[2]) * SIGMA * stretch
            leave = wp.min(t + cell_exit(here, dir), span[1])
            if majorant <= 0.0:
                t = leave
                continue
            s = pcg(s)
            step = -wp.log(1.0 - unit(s) * 0.999999) / majorant
            if t + step >= leave:
                t = leave
                continue
            t = t + step
            sig = cumulus(o + dir * t, cam, wm, shape, detail) * SIGMA * stretch
            s = pcg(s)
            if unit(s) * majorant < sig:
                hit = 1
        if hit == 0:
            if events > 0:
                radiance = radiance + wp.cw_mul(through, sky_at(lut, dir))
            alive = 0
            break
        p = o + dir * t
        if events == 0:
            first = t
        events += 1
        through = through * ALBEDO
        # The sun (a 0.53° disc, sampled): ratio-tracked transmittance out of the layer, times
        # the phase.
        s = pcg(s)
        cu = unit(s)
        s = pcg(s)
        sdir = around(sun, 1.0 - cu * (1.0 - 0.99998918), unit(s) * 6.2831853)
        # Jittered ray march (steps growing from 6 m): as unbiased as ratio tracking on average,
        # far smoother per sample.
        send = shell(p, sdir, cam, BASE, TOP)[1]
        s = pcg(s)
        step = float(6.0)
        tt = step * unit(s)
        tau = float(0.0)
        for k in range(34):
            if tt >= send or tau > 14.0:
                break
            tau += cumulus(p + sdir * tt, cam, wm, shape, detail) * SIGMA * stretch * step
            tt += step
            step *= 1.16
        ts = wp.exp(-tau)
        mu = wp.dot(dir, sdir)
        radiance = radiance + wp.cw_mul(through, sun_rgb) * (ts * phase(mu) * lux)
        # Next direction from the phase function (a mixture: pick a lobe).
        s = pcg(s)
        pick = unit(s)
        s = pcg(s)
        u = unit(s)
        s = pcg(s)
        spin = unit(s) * 6.2831853
        nmu = float(0.0)
        if pick >= W_D:
            nmu = sample_hg_mu(G_HG, u)
        else:
            # Draine by rejection from its HG envelope.
            nmu = sample_hg_mu(G_D, u)
            tries = int(0)
            while tries < 64:
                s = pcg(s)
                if unit(s) * (1.0 + ALPHA_D) <= 1.0 + ALPHA_D * nmu * nmu:
                    break
                s = pcg(s)
                nmu = sample_hg_mu(G_D, unit(s))
                tries += 1
        dir = around(dir, nmu, spin)
        o = p
        if events >= stretch_from:
            stretch = wp.max(stretch_floor, stretch * stretch_rate)
        if events >= max_events:
            alive = 0
            break
        if events > 24:
            q = wp.max(through[0], wp.max(through[1], through[2]))
            s = pcg(s)
            if unit(s) > q:
                alive = 0
                break
            through = through / q

    # A rare path can carry a spike (the droplets' forward peak): cap it, as renderers do.
    peak = wp.max(radiance[0], wp.max(radiance[1], radiance[2]))
    if peak > clamp:
        radiance = radiance * (clamp / peak)
    colour = atmos.scatter(d, sun, lux, 1.0e12, 0.0)
    trans = float(1.0)
    if first > 0.0:
        colour = atmos.scatter(d, sun, lux, first, 0.0) + wp.cw_mul(atmos.transmittance(d, first, 0.0), radiance)
        trans = 0.0
    else:
        # Cirrus, single scattering along the camera ray (it is optically thin).
        span = shell(cam, d, cam, CIRRUS_Y - CIRRUS_H, CIRRUS_Y + CIRRUS_H)
        if span[1] > span[0]:
            n = 24
            step = (span[1] - span[0]) / float(n)
            s = pcg(s)
            t = span[0] + step * unit(s)
            tau = float(0.0)
            lit = wp.vec3(0.0)
            mu = wp.dot(d, sun)
            ice = 0.7 * hg(mu, 0.8) + 0.3 * hg(mu, -0.2)
            for k in range(n):
                sig = cirrus(cam + d * t, cam, detail) * CIRRUS_SIGMA
                if sig > 0.0:
                    lit = lit + (sun_rgb * (lux * ice) + sky_ambient * INV_4PI) * (sig * step * wp.exp(-tau))
                    tau += sig * step
                t += step
            colour = colour * wp.exp(-tau) + wp.cw_mul(atmos.transmittance(d, span[0], 0.0), lit)
            trans = wp.exp(-tau)
    accum[py, px] = accum[py, px] + wp.vec4(colour[0], colour[1], colour[2], trans)
    lum = 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2]
    accum2[py, px] = accum2[py, px] + lum * lum


def build_volumes(device="cuda:0"):
    shape = wp.zeros((SHAPE_N, SHAPE_N, SHAPE_N, 2), dtype=float, device=device)
    wp.launch(build_shape, dim=(SHAPE_N, SHAPE_N, SHAPE_N), inputs=[shape, SHAPE_N], device=device)
    detail = wp.zeros((DETAIL_N, DETAIL_N, DETAIL_N), dtype=float, device=device)
    wp.launch(build_detail, dim=(DETAIL_N, DETAIL_N, DETAIL_N), inputs=[detail, DETAIL_N], device=device)
    wp.synchronize_device(device)
    return shape, detail


def build_weather_map(coverage: float, device="cuda:0"):
    wm = wp.zeros((WEATHER_N, WEATHER_N), dtype=wp.vec2, device=device)
    wp.launch(build_weather, dim=(WEATHER_N, WEATHER_N), inputs=[wm, WEATHER_N, WEATHER_HALF, float(coverage)], device=device)
    bounds = wp.zeros((COARSE_N, COARSE_N), dtype=float, device=device)
    per = WEATHER_N // COARSE_N
    wp.launch(build_bounds, dim=(COARSE_N, COARSE_N), inputs=[wm, bounds, COARSE_N, per], device=device)
    wp.synchronize_device(device)
    return wm, bounds


def sky_lut(sun, lux, height, ground_rgb, w=512, h=256, device="cuda:0"):
    lut = wp.zeros((h, w), dtype=wp.vec3, device=device)
    wp.launch(
        build_sky_lut,
        dim=(h, w),
        inputs=[lut, w, h, wp.vec3(*sun), float(lux), float(height), wp.vec3(*ground_rgb)],
        device=device,
    )
    wp.synchronize_device(device)
    return lut
