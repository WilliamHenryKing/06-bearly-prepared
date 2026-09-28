"""The game's atmosphere (src/scene/render/atmosphere.ts) on the GPU, for the bake's renders.

A line-for-line port of scatter() and transmittance(): the same density profiles, extinction,
phase functions, quadratic step spacing and multiple-scattering boost, so a clear-sky pixel in a
baked panorama equals what the game's sky shader draws. Constants come from bake/work/sky.json
(written by sky-params.mjs from the TypeScript), and check() compares against the reference
radiances recorded there.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import warp as wp

ROOT = Path(__file__).resolve().parent.parent.parent
SKY = json.loads((ROOT / "bake" / "work" / "sky.json").read_text())
_A = SKY["atmosphere"]

EARTH_R = wp.constant(float(_A["EARTH_RADIUS"]))
ATMOS_R = wp.constant(float(_A["ATMOSPHERE_RADIUS"]))
OBSERVER_H = wp.constant(float(_A["OBSERVER_HEIGHT"]))
RAY_SCAT = wp.constant(wp.vec3(*[float(v) for v in _A["RAYLEIGH_SCATTERING"]]))
RAY_H = wp.constant(float(_A["RAYLEIGH_HEIGHT"]))
MIE_SCAT = wp.constant(float(_A["MIE_SCATTERING"]))
MIE_EXT = wp.constant(float(_A["MIE_EXTINCTION"]))
MIE_H = wp.constant(float(_A["MIE_HEIGHT"]))
MIE_G = wp.constant(float(_A["MIE_G"]))
OZONE = wp.constant(wp.vec3(*[float(v) for v in _A["OZONE_ABSORPTION"]]))
OZONE_C = wp.constant(float(_A["OZONE_CENTRE"]))
OZONE_W = wp.constant(float(_A["OZONE_HALF_WIDTH"]))
MULTI = wp.constant(float(_A["MULTIPLE_SCATTERING"]))
VIEW_STEPS = wp.constant(16)
LIGHT_STEPS = wp.constant(6)


@wp.func
def sphere_hit(o: wp.vec3, d: wp.vec3, r: float) -> wp.vec2:
    b = wp.dot(o, d)
    c = wp.dot(o, o) - r * r
    disc = b * b - c
    if disc < 0.0:
        return wp.vec2(-1.0, -1.0)
    s = wp.sqrt(disc)
    return wp.vec2(-b - s, -b + s)


@wp.func
def density(height: float) -> wp.vec3:
    ozone = wp.max(0.0, 1.0 - wp.abs(height - OZONE_C) / OZONE_W)
    return wp.vec3(wp.exp(-height / RAY_H), wp.exp(-height / MIE_H), ozone)


@wp.func
def extinction(depth: wp.vec3) -> wp.vec3:
    return RAY_SCAT * depth[0] + wp.vec3(MIE_EXT * depth[1]) + OZONE * depth[2]


@wp.func
def exp3(v: wp.vec3) -> wp.vec3:
    return wp.vec3(wp.exp(-v[0]), wp.exp(-v[1]), wp.exp(-v[2]))


@wp.func
def origin_at(altitude: float) -> wp.vec3:
    return wp.vec3(0.0, EARTH_R + OBSERVER_H + altitude, 0.0)


@wp.func
def scatter(direction: wp.vec3, light: wp.vec3, lux: float, max_distance: float, altitude: float) -> wp.vec3:
    """In-scattered radiance (cd/m²) toward an observer `altitude` metres above the game's
    observer, along `direction`, up to `max_distance` metres (mirrors atmosphere.ts)."""
    o = origin_at(altitude)
    d = wp.normalize(direction)
    src = wp.normalize(light)
    end = sphere_hit(o, d, ATMOS_R)[1]
    g = sphere_hit(o, d, EARTH_R)
    if g[0] > 0.0:
        end = wp.min(end, g[0])
    end = wp.min(end, max_distance)
    depth = wp.vec3(0.0)
    ray = wp.vec3(0.0)
    mie = wp.vec3(0.0)
    for i in range(VIEW_STEPS):
        u0 = float(i) / float(VIEW_STEPS)
        u1 = float(i + 1) / float(VIEW_STEPS)
        t = end * (u0 * u0 + u1 * u1) * 0.5
        step = end * (u1 * u1 - u0 * u0)
        p = o + d * t
        dd = density(wp.length(p) - EARTH_R) * step
        depth = depth + dd
        if sphere_hit(p, src, EARTH_R)[0] > 0.0:
            continue
        lend = sphere_hit(p, src, ATMOS_R)[1]
        ldepth = wp.vec3(0.0)
        for j in range(LIGHT_STEPS):
            v0 = float(j) / float(LIGHT_STEPS)
            v1 = float(j + 1) / float(LIGHT_STEPS)
            lt = lend * (v0 * v0 + v1 * v1) * 0.5
            ls = lend * (v1 * v1 - v0 * v0)
            ldepth = ldepth + density(wp.length(p + src * lt) - EARTH_R) * ls
        att = exp3(extinction(depth + ldepth))
        ray = ray + att * dd[0]
        mie = mie + att * dd[1]
    mu = wp.dot(d, src)
    rp = 0.0596831 * (1.0 + mu * mu)
    g2 = MIE_G * MIE_G
    mp = 0.1193662 * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * wp.pow(1.0 + g2 - 2.0 * MIE_G * mu, 1.5))
    r = wp.cw_mul(ray, RAY_SCAT)
    m = mie * MIE_SCAT
    return (r * rp + m * mp + (r + m) * 0.0795775 * (MULTI - 1.0)) * lux


@wp.func
def transmittance(direction: wp.vec3, max_distance: float, altitude: float) -> wp.vec3:
    """Transmittance along a ray (to space, or to max_distance), 0 into the ground."""
    o = origin_at(altitude)
    d = wp.normalize(direction)
    g = sphere_hit(o, d, EARTH_R)
    end = sphere_hit(o, d, ATMOS_R)[1]
    if g[0] > 0.0:
        if max_distance > g[0]:
            return wp.vec3(0.0)
    end = wp.min(end, max_distance)
    depth = wp.vec3(0.0)
    for i in range(VIEW_STEPS):
        u0 = float(i) / float(VIEW_STEPS)
        u1 = float(i + 1) / float(VIEW_STEPS)
        p = o + d * (end * (u0 * u0 + u1 * u1) * 0.5)
        depth = depth + density(wp.length(p) - EARTH_R) * (end * (u1 * u1 - u0 * u0))
    return exp3(extinction(depth))


@wp.kernel
def _check(dirs: wp.array(dtype=wp.vec3), sun: wp.vec3, lux: float, out: wp.array(dtype=wp.vec3)):
    i = wp.tid()
    k = i % 3
    d = dirs[i // 3]
    if k == 0:
        out[i] = scatter(d, sun, lux, 1.0e12, 0.0)
    elif k == 1:
        out[i] = scatter(d, sun, lux, 2000.0, 0.0)
    else:
        out[i] = transmittance(d, 1.0e12, 0.0)


def check() -> float:
    """Worst relative error against atmosphere.ts over the recorded directions."""
    dirs = np.array([c["dir"] for c in SKY["checks"]], dtype=np.float32)
    ref = []
    for c in SKY["checks"]:
        ref += [c["radiance"], c["radiance2km"], c["transmittance"]]
    ref = np.array(ref, dtype=np.float64)
    out = wp.zeros(len(ref), dtype=wp.vec3, device="cuda:0")
    wp.launch(
        _check,
        dim=len(ref),
        inputs=[wp.array(dirs, dtype=wp.vec3, device="cuda:0"), wp.vec3(*SKY["sun"]["direction"]),
                float(_A["SOLAR_ILLUMINANCE"]), out],
        device="cuda:0",
    )
    got = out.numpy().astype(np.float64)
    return float(np.max(np.abs(got - ref) / (np.abs(ref) + 1e-3)))


if __name__ == "__main__":
    wp.config.kernel_cache_dir = str(Path(__file__).resolve().parent / ".cache")
    wp.init()
    print(f"worst relative error vs atmosphere.ts: {check():.2e}")
