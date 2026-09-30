import { describe, expect, test } from "bun:test";
import type { ItemId } from "../src/game/items";
import { BRANCHES, BUMP_RADIUS, CROWD, walkerAt } from "../src/game/obstacles";
import {
  createRun,
  drainEvents,
  fetchItem,
  type Input,
  JUMP_SPEED,
  movePacked,
  type RunEvent,
  type RunState,
  startHike,
  stepRun,
  togglePack,
} from "../src/game/run";
import { type TeaStyle, teaOutcome } from "../src/game/tea";
import { CHECKPOINTS, GREEN, LOGS, TRAIL_LENGTH, type Zone, zoneAt } from "../src/game/trail";

const DT = 1 / 120;
const CONTROL_INTERVAL = 0.1;

function crowded(time: number, d: number) {
  for (const walker of CROWD) {
    for (let ahead = 0; ahead <= 1.2; ahead += 0.15) {
      const p = walkerAt(walker, time + ahead);
      if (Math.hypot(p.d - d, p.x) < BUMP_RADIUS + 0.3) return true;
    }
  }
  return false;
}

/** Decisions every 100 ms, with only the held digital controls available to a player. */
function controls(s: RunState, fetchAtLookout: boolean): Input {
  const branch = BRANCHES.find((b) => b.at > s.d - 0.2);
  const target = branch && branch.at - s.d < 3 ? -branch.side * 0.19 : 0;
  const demand = 3 * (target - s.balance.tilt) - 0.9 * s.balance.spin + target * 2;
  const lean = demand > 0.04 ? 1 : demand < -0.04 ? -1 : 0;
  let walk = !(fetchAtLookout && s.d > 205 && (s.dropped.length > 0 || s.busy > 0));
  if (s.d > GREEN.from - 3 && s.d < GREEN.to + 1) {
    const ahead = s.d + Math.max(0.6, s.speed) * 0.8;
    walk = !crowded(s.time, ahead) || crowded(s.time, s.d);
  }
  const log = LOGS[s.logsPassed];
  const gap = log ? log.at - s.d : -1;
  const peak = (JUMP_SPEED * (1 - 0.18 * s.stats.wobble)) / 9.8;
  const jump = !!log && !s.airborne && gap > 0 && gap <= Math.max(0.3, s.speed * peak) + 0.02;
  return { walk, lean, jump };
}

function journey(packed: ItemId[], fetchAtLookout: boolean) {
  const s = createRun(packed);
  startHike(s);
  let input: Input = { walk: false, lean: 0, jump: false };
  let nextDecision = 0;
  const zones = new Set<Zone>();
  const events: RunEvent[] = [];
  for (let tick = 0; tick < 600 / DT && s.phase === "hiking"; tick++) {
    zones.add(zoneAt(s.d));
    const inventory = [...s.stack, ...s.dropped.map((drop) => drop.id), ...s.stolen];
    if (
      inventory.length !== packed.length ||
      new Set(inventory).size !== inventory.length ||
      packed.some((id) => !inventory.includes(id))
    ) {
      throw new Error(`Inventory changed at ${s.d.toFixed(2)} m: ${inventory.join(", ")}`);
    }
    if (fetchAtLookout && s.d > 205 && s.busy === 0 && !s.airborne) {
      const next = s.dropped[0];
      if (next) fetchItem(s, next.id);
    }
    if (tick * DT >= nextDecision) {
      nextDecision += CONTROL_INTERVAL;
      input = controls(s, fetchAtLookout);
    }
    stepRun(s, input, DT);
    events.push(...drainEvents(s));
  }
  return { s, events, zones };
}

describe("the complete trail with normal controls", () => {
  const cases: { label: string; packed: ItemId[]; style: TeaStyle; fetch: boolean }[] = [
    { label: "just the view", packed: [], style: "view", fetch: false },
    { label: "minimal tea", packed: ["kettle"], style: "neat", fetch: false },
    {
      label: "the default picnic",
      packed: ["kettle", "teacups", "biscuits"],
      style: "picnic",
      fetch: false,
    },
    {
      label: "a sensible four-piece picnic",
      packed: ["kettle", "blanket", "teacups", "biscuits"],
      style: "picnic",
      fetch: false,
    },
    {
      label: "the absurd lounge, retrieving spills before tea",
      packed: ["kettle", "chair", "lamp", "blanket", "teacups", "biscuits"],
      style: "lounge",
      fetch: true,
    },
  ];

  for (const route of cases) {
    test(`${route.label} can cross every stretch and replay`, () => {
      const { s, events, zones } = journey(route.packed, route.fetch);
      expect(s.phase).toBe("tea");
      expect(s.d).toBe(TRAIL_LENGTH);
      expect([...zones]).toEqual([
        "meadow",
        "hairpin",
        "logs",
        "green",
        "orchard",
        "lane",
        "ledge",
        "lookout",
      ]);
      expect(events.flatMap((event) => (event.type === "checkpoint" ? [event.at] : []))).toEqual(
        CHECKPOINTS.slice(1),
      );
      expect(events.filter((event) => event.type === "arrive")).toHaveLength(1);
      expect(events.filter((event) => event.type === "log")).toHaveLength(LOGS.length);
      expect(events.filter((event) => event.type === "branch")).toHaveLength(BRANCHES.length);
      expect(events).toContainEqual({ type: "goose", kind: "honk" });
      expect(events).toContainEqual({ type: "goose", kind: "quit" });
      expect(s.trips).toBe(0);
      expect(s.topples).toBe(0);
      expect(s.bumps).toBe(0);
      expect([...s.stack].sort()).toEqual([...route.packed].sort());
      expect(s.dropped).toEqual([]);
      expect(s.stolen).toEqual([]);
      const outcome = teaOutcome(s.packed, s.stack);
      expect(outcome.style).toBe(route.style);
      expect(outcome.lost).toEqual([]);
      if (route.fetch) {
        expect(s.spills).toBeGreaterThan(0);
        expect(s.fetches).toBe(s.spills);
      }

      const complete = structuredClone(s);
      startHike(s);
      stepRun(s, { walk: true, lean: 1, jump: true }, 1);
      togglePack(s, "chair");
      movePacked(s, 0, 1);
      expect(fetchItem(s, "biscuits")).toBe(false);
      expect(s).toEqual(complete);

      const replay = createRun(s.packed);
      expect(replay.phase).toBe("packing");
      expect(replay.packed).toEqual(route.packed);
      expect(replay.stack).toEqual(route.packed);
      expect(replay.d).toBe(0);
      expect(replay.time).toBe(0);
      expect(replay.penalty).toBe(0);
      expect(replay.topples + replay.trips + replay.spills + replay.fetches).toBe(0);
      expect(replay.dropped).toEqual([]);
      expect(replay.stolen).toEqual([]);
      expect(replay.events).toEqual([]);
      togglePack(replay, "chair");
      expect(s).toEqual(complete);
    });
  }
});
