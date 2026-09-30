import { effectiveGrip } from "../game/load";
import type { Input, RunState } from "../game/run";
import { LOGS, zoneAt } from "../game/trail";

export interface GuideProgress {
  step: number;
  fromDistance: number;
  fromLogs: number;
  fromTrips: number;
  leanSeconds: number;
  steadySeconds: number;
  jumped: boolean;
}

export function startGuide(run: RunState, step = 0): GuideProgress {
  return {
    step,
    fromDistance: run.d,
    fromLogs: run.logsPassed,
    fromTrips: run.trips,
    leanSeconds: 0,
    steadySeconds: 0,
    jumped: false,
  };
}

/** Evidence from the actual hike advances instructions; idle timers never teach an action. */
export function stepGuide(
  progress: GuideProgress,
  run: RunState,
  input: Input,
  dt: number,
): GuideProgress {
  if (run.phase !== "hiking" || progress.step < 0 || !Number.isFinite(dt) || dt <= 0)
    return progress;
  const elapsed = Math.min(dt, 0.1);
  if (progress.step === 0)
    return run.d - progress.fromDistance > 2.5 ? startGuide(run, 1) : progress;
  if (progress.step === 1) {
    const opposing =
      input.lean !== 0 &&
      (run.stack.length === 0 ||
        Math.abs(run.balance.tilt) < 0.03 ||
        input.lean * run.balance.tilt < 0);
    const next = {
      ...progress,
      leanSeconds: progress.leanSeconds + (opposing && run.busy <= 0 ? elapsed : 0),
    };
    return next.leanSeconds >= 0.5 ? startGuide(run, 2) : next;
  }
  if (progress.step === 2) {
    const grips = run.stack.map((_, i) => effectiveGrip(run.stack, i));
    const safe = grips.length ? Math.min(...grips) : 0.4;
    const movingSafely = zoneAt(run.d) === "lane" ? input.walk : !input.walk && run.speed < 0.2;
    const settled =
      movingSafely &&
      run.busy <= 0 &&
      !run.airborne &&
      Math.abs(run.balance.tilt) < safe * 0.8 &&
      run.slides.every((slide) => Math.abs(slide) < 0.1);
    const next = { ...progress, steadySeconds: settled ? progress.steadySeconds + elapsed : 0 };
    return next.steadySeconds >= 0.7 ? startGuide(run, 3) : next;
  }
  if (run.trips > progress.fromTrips)
    return { ...progress, fromLogs: run.logsPassed, fromTrips: run.trips, jumped: false };
  const next = { ...progress, jumped: progress.jumped || (run.airborne && !!input.jump) };
  const cleanLog = run.logsPassed > progress.fromLogs;
  const cleanPractice = run.logsPassed >= LOGS.length && next.jumped && !run.airborne;
  return next.jumped && (cleanLog || cleanPractice) ? startGuide(run, -1) : next;
}
