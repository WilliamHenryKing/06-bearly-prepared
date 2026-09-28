// Adapted from ODD TIDE (src/world/render/sky-model.ts), reused with permission, and re-placed
// for BEARLY PREPARED: a temperate mountain meadow on a midsummer afternoon.
// The meadow's fictional sky. Shaped by real astronomy (declination, hour angle, air mass)
// so that sun, moon, sky and exposure agree with one another, but it is not a forecast for
// a real place. All light values are physical (lux, cd/m²) and become display values only
// through the single pre-exposure factor derived from EV100.

export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;
/** An alpine meadow at 46° N in early July. */
export const LATITUDE = 46 * DEG;
export const SUN_DECLINATION = 22 * DEG;
export const SOLAR_NOON = 13.4;
/** Rotates the compass so the afternoon sun rakes across the trail from the walker's left. */
export const COMPASS_OFFSET = 330 * DEG;
/** A waxing gibbous moon, north of the sun's path. Its phase follows from the elongation. */
export const MOON_DECLINATION = 6 * DEG;
export const MOON_LAG_HOURS = 7.3;

import { luminance, SOLAR_ILLUMINANCE, transmittance } from "./atmosphere";

export type Body = { azimuth: number; elevation: number; direction: Vec3 };

export function horizontalToWorld(azimuth: number, elevation: number): Vec3 {
  const a = azimuth + COMPASS_OFFSET;
  const c = Math.cos(elevation);
  return [Math.sin(a) * c, Math.sin(elevation), -Math.cos(a) * c];
}

/** Azimuth from north through east, elevation above the horizon, both in radians. */
export function bodyPosition(hourAngle: number, declination: number): Body {
  const sinElevation =
    Math.sin(LATITUDE) * Math.sin(declination) +
    Math.cos(LATITUDE) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinElevation)));
  const azimuth =
    Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(LATITUDE) - Math.tan(declination) * Math.cos(LATITUDE),
    ) + Math.PI;
  return { azimuth, elevation, direction: horizontalToWorld(azimuth, elevation) };
}

export const sunAt = (hour: number) =>
  bodyPosition((hour - SOLAR_NOON) * 15 * DEG, SUN_DECLINATION);
export const moonAt = (hour: number) =>
  bodyPosition((hour - SOLAR_NOON - MOON_LAG_HOURS) * 15 * DEG, MOON_DECLINATION);

/** Direct normal illuminance of the sun at the island and its colour (luminance-normalised). */
export function directLight(direction: Vec3): { lux: number; colour: Vec3 } {
  const t = transmittance(direction);
  const lum = luminance(t);
  const colour = (lum > 1e-9 ? t.map((v) => v / lum) : [1, 0.6, 0.3]) as Vec3;
  return { lux: SOLAR_ILLUMINANCE * lum, colour };
}

/** Illuminated fraction of the moon's disc from the sun–moon elongation. */
export function moonPhase(sun: Vec3, moon: Vec3): number {
  const cosElongation = sun[0] * moon[0] + sun[1] * moon[1] + sun[2] * moon[2];
  return (1 - cosElongation) / 2;
}

/** Direct moonlight at the island, lux: full moon 0.32 lx outside the atmosphere. */
export function moonLux(direction: Vec3, phase: number): number {
  const phaseFactor = phase ** 2.2; // opposition surge makes partial phases disproportionately dim
  return 0.32 * phaseFactor * luminance(transmittance(direction));
}

/**
 * Authored exposure (EV100) against sun elevation, derived from the atmosphere's own ground
 * illuminance so an 18% grey card lands near 0.13 display-linear by day, easing to about 0.1 at
 * golden hour and 0.03 at night. Night is held darker than a "correct" moonlit exposure so it
 * reads as night; the scotopic grade supplies the colour shift.
 */
const EV_KEYS: [number, number][] = [
  [-90, -2.2],
  [-12, -2.2],
  [-9, -1.2],
  [-6, 3.6],
  [-3, 7.8],
  [0, 10.2],
  [2, 11],
  [5, 11.9],
  [10, 13],
  [20, 13.8],
  [30, 14.4],
  [45, 14.8],
  [90, 15],
];
export function ev100(sunElevation: number): number {
  const degrees = sunElevation / DEG;
  for (let i = 1; i < EV_KEYS.length; i++) {
    const [x1, y1] = EV_KEYS[i] as [number, number];
    const [x0, y0] = EV_KEYS[i - 1] as [number, number];
    if (degrees <= x1) {
      const t = (degrees - x0) / (x1 - x0);
      const s = t * t * (3 - 2 * t);
      return y0 + (y1 - y0) * s;
    }
  }
  return (EV_KEYS[EV_KEYS.length - 1] as [number, number])[1];
}
/** Converts luminance (cd/m²) to renderer units: saturation-based exposure at ISO 100. */
export const preExposure = (ev: number) => 1 / (1.2 * 2 ** ev);

/** 0 in daylight, 1 in full night: drives the scotopic grade and star visibility. */
export const nightFactor = (sunElevation: number) =>
  1 - smoothstep(-14 * DEG, -3 * DEG, sunElevation);

export type Celestial = {
  hour: number;
  sun: Body;
  moon: Body;
  sunLux: number;
  sunColour: Vec3;
  moonLux: number;
  moonPhase: number;
  ev100: number;
  preExposure: number;
  night: number;
};

export function celestial(hour: number): Celestial {
  const sun = sunAt(hour);
  const moon = moonAt(hour);
  const direct = directLight(sun.direction);
  const ev = ev100(sun.elevation);
  const phase = moonPhase(sun.direction, moon.direction);
  return {
    hour,
    sun,
    moon,
    sunLux: direct.lux,
    sunColour: direct.colour,
    moonLux: moon.elevation > -0.01 ? moonLux(moon.direction, phase) : 0,
    moonPhase: phase,
    ev100: ev,
    preExposure: preExposure(ev),
    night: nightFactor(sun.elevation),
  };
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
