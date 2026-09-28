// Landscape bake: the game's own sun and sky, for the GPU renders (tools/bake/*.py).
// Writes bake/work/sky.json: the hour (read from stage.ts), the sun's direction, illuminance and
// colour, the single pre-exposure, the atmosphere's constants, and reference radiances from
// atmosphere.ts that the CUDA port (atmos.py) must reproduce.
//
// Run: bun tools/bake/sky-params.mjs

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as A from "../../src/scene/render/atmosphere.ts";
import { celestial } from "../../src/scene/render/sky-model.ts";

const stage = readFileSync(new URL("../../src/scene/stage.ts", import.meta.url), "utf8");
const HOUR = Number(/export const HOUR = ([\d.]+)/.exec(stage)?.[1]);
if (!Number.isFinite(HOUR)) throw new Error("HOUR not found in stage.ts");

const sky = celestial(HOUR);
const sun = sky.sun.direction;
const checks = [
  [0, 1, 0],
  [1, 0.2, 0],
  [-1, 0.05, 0.3],
  [0.3, 0.5, -0.8],
  [sun[0], sun[1] + 0.05, sun[2]],
  [-sun[0], 0.1, -sun[2]],
].map((d) => {
  const l = Math.hypot(d[0], d[1], d[2]);
  const dir = [d[0] / l, d[1] / l, d[2] / l];
  return {
    dir,
    radiance: A.scatter(dir, sun, A.SOLAR_ILLUMINANCE),
    radiance2km: A.scatter(dir, sun, A.SOLAR_ILLUMINANCE, 2000),
    transmittance: A.transmittance(dir),
  };
});

const out = {
  hour: HOUR,
  sun: { direction: sun, elevationDeg: (sky.sun.elevation * 180) / Math.PI, azimuthDeg: (sky.sun.azimuth * 180) / Math.PI },
  sunLux: sky.sunLux,
  sunColour: sky.sunColour,
  preExposure: sky.preExposure,
  ev100: sky.ev100,
  atmosphere: {
    EARTH_RADIUS: A.EARTH_RADIUS,
    ATMOSPHERE_RADIUS: A.ATMOSPHERE_RADIUS,
    OBSERVER_HEIGHT: A.OBSERVER_HEIGHT,
    RAYLEIGH_SCATTERING: A.RAYLEIGH_SCATTERING,
    RAYLEIGH_HEIGHT: A.RAYLEIGH_HEIGHT,
    MIE_SCATTERING: A.MIE_SCATTERING,
    MIE_EXTINCTION: A.MIE_EXTINCTION,
    MIE_HEIGHT: A.MIE_HEIGHT,
    MIE_G: A.MIE_G,
    OZONE_ABSORPTION: A.OZONE_ABSORPTION,
    OZONE_CENTRE: A.OZONE_CENTRE,
    OZONE_HALF_WIDTH: A.OZONE_HALF_WIDTH,
    SOLAR_ILLUMINANCE: A.SOLAR_ILLUMINANCE,
    MULTIPLE_SCATTERING: A.MULTIPLE_SCATTERING,
  },
  checks,
};
mkdirSync("bake/work", { recursive: true });
writeFileSync("bake/work/sky.json", JSON.stringify(out, null, 2));
console.log(
  `hour ${HOUR}: sun elevation ${out.sun.elevationDeg.toFixed(1)}°, azimuth ${out.sun.azimuthDeg.toFixed(1)}°, ` +
    `dir [${sun.map((v) => v.toFixed(3)).join(", ")}], ${Math.round(sky.sunLux)} lux, pre-exposure ${sky.preExposure.toExponential(3)}`,
);
