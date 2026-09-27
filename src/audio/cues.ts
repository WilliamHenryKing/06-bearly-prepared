import type { ItemId } from "../game/items";
import type { RunEvent, RunState } from "../game/run";
import type { TeaOutcome } from "../game/tea";
import { gustAt, LEDGE, TRAIL_LENGTH } from "../game/trail";
import { sound } from "./sound";

// Decides what is heard: footsteps from the walk cycle, creaks when the load starts to slide,
// the thump of every spill, wind that swells before each gust, and the tea being unpacked.

export class SoundCues {
  private lastStep = 0;
  private lastWorst = 0;
  private creakCool = 0;
  private teaClock = -1;
  private silence = false;

  reset() {
    this.teaClock = -1;
    this.silence = false;
    this.lastStep = 0;
    this.lastWorst = 0;
  }

  events(events: RunEvent[], s: RunState) {
    for (const e of events) {
      if (e.type === "drop") sound.play("cloth", { gain: 0.7, pan: e.side * 0.6 });
      else if (e.type === "topple") {
        sound.play("topple", { gain: 1, pan: e.side * 0.4 });
        sound.play("cloth", { gain: 0.6, delay: 1.1 });
      } else if (e.type === "log") {
        sound.play("log", { gain: 0.55 + 0.2 * Math.min(1, s.speed), pan: e.lurch * 0.3 });
        sound.play("creak", { gain: 0.35, pan: e.lurch * 0.5, delay: 0.08 });
      } else if (e.type === "fetch") {
        sound.play("cloth", { gain: 0.7 });
        sound.play(e.id, { gain: 0.5, delay: 0.35 });
      } else if (e.type === "checkpoint" && e.at > 0) sound.play("flag", { gain: 0.6 });
    }
  }

  /** A spilled item hits the grass. */
  land(id: ItemId) {
    sound.play(id, { gain: 0.9 });
  }

  arrive(pops: { id: ItemId; delay: number }[], outcome: TeaOutcome) {
    this.teaClock = 0;
    this.silence = outcome.silence;
    sound.play("jingle-tea", { gain: 0.7, delay: 0.2 });
    for (const p of pops) sound.play(p.id, { gain: 0.55, delay: p.delay });
    const last = pops.reduce((m, p) => Math.max(m, p.delay), 0);
    if (outcome.arrived.includes("kettle")) sound.whistle(last + 0.8);
    if (this.silence) sound.play("silence", { gain: 0.8, delay: 1.5 });
  }

  frame(s: RunState, dt: number, paused: boolean) {
    if (this.teaClock >= 0) {
      this.teaClock += dt;
      const hush = this.silence && this.teaClock > 1.3 && this.teaClock < 6;
      sound.setBeds({ music: hush ? 0 : 0.34, birds: 0.4, wind: 0.08 }, 0.5);
      return;
    }
    if (s.phase === "packing") {
      sound.setBeds({ music: 0.3, birds: 0.35, wind: 0.06 });
      return;
    }

    // Footsteps land twice per stride; heavy loads thud lower.
    const step = Math.floor(s.stepPhase / Math.PI);
    if (step !== this.lastStep && s.speed > 0.15) {
      const deck = s.d > TRAIL_LENGTH - 2;
      sound.play(deck ? "step-wood" : "step-grass", {
        gain: 0.25 + 0.25 * Math.min(1, s.speed / 1.8),
        rate: 1.05 - s.stats.wobble * 0.2,
        pan: step % 2 ? 0.15 : -0.15,
      });
    }
    this.lastStep = step;

    // The load creaks as soon as something begins to slide.
    this.creakCool = Math.max(0, this.creakCool - dt);
    let worst = 0;
    let side = 0;
    for (const v of s.slides) {
      if (Math.abs(v) > worst) {
        worst = Math.abs(v);
        side = Math.sign(v);
      }
    }
    if (worst > 0.3 && this.lastWorst <= 0.3 && this.creakCool === 0) {
      sound.play("creak", { gain: 0.6, pan: side * 0.7 });
      this.creakCool = 0.8;
    }
    this.lastWorst = worst;

    // Wind: a breeze on the meadow, stronger on the ledge, swelling with each whistle and gust.
    const onLedge = s.d >= LEDGE.from && s.d < LEDGE.to;
    const g = onLedge ? gustAt(s.gustClock) : null;
    const wind = onLedge ? 0.22 + (g?.warning ? 0.15 : 0) + (g?.strength ?? 0) * 0.5 : 0.07;
    sound.setBeds(
      {
        music: paused ? 0.12 : onLedge ? 0.2 : 0.28,
        birds: onLedge ? 0.15 : 0.35,
        wind: paused ? wind * 0.4 : wind,
      },
      0.25,
    );
  }
}
