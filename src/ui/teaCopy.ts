import type { TeaOutcome } from "../game/tea";

export interface HikeTally {
  spills: number;
  fetches: number;
  topples: number;
  trips: number;
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function teaSummary(tally: HikeTally, outcome: TeaOutcome) {
  const carried = `Carried ${plural(outcome.arrived.length, "thing", "things")} to the top`;
  if (tally.spills === 0 && tally.topples === 0 && tally.trips === 0 && outcome.lost.length === 0)
    return `${carried} without spilling a thing.`;
  const left = outcome.lost.length
    ? ` ${plural(outcome.lost.length, "thing was", "things were")} left behind.`
    : "";
  return `${carried}: ${plural(tally.spills, "spill", "spills")}, ${plural(tally.fetches, "fetch", "fetches")}, ${plural(tally.topples, "topple", "topples")}, ${plural(tally.trips, "trip", "trips")}.${left}`;
}
