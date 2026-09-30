import type { ItemId } from "../game/items";
import type { RunEvent, RunState } from "../game/run";
import type { TeaOutcome } from "../game/tea";
import { GREEN, gustAt, LEDGE, TRAIL_LENGTH } from "../game/trail";
import { POND } from "../scene/pond";
import { type Sound, sound } from "./sound";

// Decides what is heard: footsteps from the walk cycle, creaks when the load starts to slide,
// the thump of every spill, wind that swells before each gust, and the tea being unpacked.

export class SoundCues {
  constructor(private audio: Sound = sound) {}
  private lastWorst = 0;
  private creakCool = 0;
  private teaClock = -1;
  private silence = false;
  /** Seconds to the next phone ping on the green. */
  private pingIn = 1;

  reset() {
    this.audio.cancelPending();
    this.creakCool = 0;
    this.pingIn = 1;
    this.teaClock = -1;
    this.silence = false;
    this.lastWorst = 0;
  }

  events(events: RunEvent[], s: RunState) {
    for (const e of events) {
      if (e.type === "drop") this.audio.play("cloth", { gain: 0.7, pan: e.side * 0.6 });
      else if (e.type === "topple") {
        this.audio.play("topple", { gain: 1, pan: e.side * 0.4 });
        this.audio.play("cloth", { gain: 0.6, delay: 1.1 });
      } else if (e.type === "log") {
        this.audio.play("log", { gain: 0.55 + 0.2 * Math.min(1, s.speed), pan: e.lurch * 0.3 });
        this.audio.play("creak", { gain: 0.35, pan: e.lurch * 0.5, delay: 0.08 });
      } else if (e.type === "fetch") {
        this.audio.play("cloth", { gain: 0.7 });
        this.audio.play(e.id, { gain: 0.5, delay: 0.35 });
      } else if (e.type === "checkpoint" && e.at > 0) this.audio.play("flag", { gain: 0.6 });
      else if (e.type === "jump") this.audio.whoosh(0, 0.8);
      else if (e.type === "land") {
        this.audio.thud(0, 0.4 + 0.6 * e.strength, 1.1);
        this.audio.play("step-grass", { gain: 0.35 + 0.3 * e.strength, rate: 0.85 });
        if (e.lurch !== 0)
          this.audio.play("creak", { gain: 0.35, pan: e.lurch * 0.5, delay: 0.05 });
      } else if (e.type === "trip") {
        this.audio.play("log", { gain: 0.8 });
        this.audio.thud(0.18, 1, 0.8);
        this.audio.play("topple", { gain: 0.9, delay: 0.15 });
        this.audio.play("cloth", { gain: 0.6, delay: 0.5 });
      } else if (e.type === "bump") {
        this.audio.play("cloth", { gain: 0.5, pan: e.side * 0.5 });
        this.audio.thud(0, 0.35, 1.4);
        this.audio.ping(0.15, e.side * 0.6, 1.2);
      } else if (e.type === "branch") {
        this.audio.rustle(0, e.side * 0.6, e.hit ? 1.2 : 0.5);
        if (e.hit) this.audio.thud(0.25, 0.5, 2.2);
      } else if (e.type === "goose") {
        if (e.kind === "peck") {
          this.audio.honk(0, e.side ? e.side * 0.4 : 0, 0.7);
          this.audio.thud(0.05, 0.35, 1.8);
        } else this.audio.honk(0, 0, e.kind === "quit" ? 0.8 : 1.1);
      }
    }
  }

  /** A foot lands (from the bear's walk cycle); heavy loads thud lower. */
  footfall(side: number, strength: number, s: RunState, splash = false) {
    if (s.phase !== "hiking") return;
    const deck = s.d > TRAIL_LENGTH - 2;
    if (splash) {
      this.audio.play("splash", {
        gain: 0.3 + 0.35 * strength,
        rate: 0.9 + Math.random() * 0.2,
        pan: side * 0.2,
      });
      return;
    }
    this.audio.play(deck ? "step-wood" : "step-grass", {
      gain: 0.2 + 0.25 * strength,
      rate: 1.05 - s.stats.wobble * 0.2,
      pan: side * 0.15,
    });
  }

  /** The bear shakes the water off. */
  shake() {
    this.audio.play("shake", { gain: 0.7 });
  }

  /** A spilled item hits the grass. */
  land(id: ItemId) {
    this.audio.play(id, { gain: 0.9 });
  }

  arrive(pops: { id: ItemId; delay: number }[], outcome: TeaOutcome) {
    this.teaClock = 0;
    this.silence = outcome.silence;
    this.audio.play("jingle-tea", { gain: 0.7, delay: 0.2 });
    for (const p of pops) this.audio.play(p.id, { gain: 0.55, delay: p.delay });
    const last = pops.reduce((m, p) => Math.max(m, p.delay), 0);
    if (outcome.arrived.includes("kettle")) this.audio.whistle(last + 0.8);
    if (this.silence) this.audio.play("silence", { gain: 0.8, delay: 1.5 });
  }

  frame(s: RunState, dt: number, paused: boolean) {
    if (this.teaClock >= 0) {
      this.teaClock += dt;
      const hush = this.silence && this.teaClock > 1.3 && this.teaClock < 6;
      this.audio.setBeds({ music: hush ? 0 : 0.34, birds: 0.4, wind: 0.08, water: 0 }, 0.5);
      return;
    }
    if (s.phase === "packing") {
      this.audio.setBeds({ music: 0.3, birds: 0.35, wind: 0.06, water: 0 });
      return;
    }

    // The village green chirps with other people's notifications.
    if (s.d > GREEN.from - 8 && s.d < GREEN.to + 4) {
      this.pingIn -= dt;
      if (this.pingIn <= 0) {
        this.audio.ping(0, Math.random() * 1.6 - 0.8, 0.45 + Math.random() * 0.4);
        this.pingIn = 1.2 + Math.random() * 3;
      }
    }

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
      this.audio.play("creak", { gain: 0.6, pan: side * 0.7 });
      this.creakCool = 0.8;
    }
    this.lastWorst = worst;

    // Wind: a breeze on the meadow, stronger on the ledge, swelling with each whistle and gust.
    const onLedge = s.d >= LEDGE.from && s.d < LEDGE.to;
    const g = onLedge ? gustAt(s.gustClock) : null;
    const wind = onLedge ? 0.22 + (g?.warning ? 0.15 : 0) + (g?.strength ?? 0) * 0.5 : 0.07;
    this.audio.setBeds(
      {
        music: paused ? 0.12 : onLedge ? 0.2 : 0.28,
        birds: onLedge ? 0.15 : 0.35,
        wind: paused ? wind * 0.4 : wind,
        // The pond laps louder as the bear nears it and fades once it is well behind.
        water: 0.55 * Math.max(0, Math.min(1, 1 - (Math.abs(s.d - POND.d) - 2) / 14)),
      },
      0.25,
    );
  }
}
