import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type ItemId, item } from "../game/items";
import { CHECKPOINTS, GREEN, LANE, LEDGE, LOGS, ORCHARD, TRAIL_LENGTH } from "../game/trail";
import { Controls } from "./Controls";
import { focusHikeControl } from "./focus";
import { ItemIcon } from "./ItemIcon";
import type { HudState } from "./store";
import { TiltMeter } from "./TiltMeter";

// The hike: trail progress with its obstacles, the load gauge, gust warnings,
// spilled items waiting to be fetched and the hold-to-act controls.

const MARKS = [
  { at: 22, label: "Hairpin" },
  { at: (LOGS[0]?.at ?? 47) + 6, label: "Logs" },
  { at: (GREEN.from + GREEN.to) / 2, label: "Green" },
  { at: (ORCHARD.from + ORCHARD.to) / 2, label: "Orchard" },
  { at: (LANE.from + LANE.to) / 2, label: "Goose" },
  { at: (LEDGE.from + LEDGE.to) / 2, label: "Ledge" },
];

const ZONE_NAMES: Record<HudState["zone"], string> = {
  meadow: "Meadow path",
  hairpin: "The hairpin",
  logs: "Log steps",
  green: "The village green",
  orchard: "The orchard",
  lane: "Goose Lane",
  ledge: "Windy ledge",
  lookout: "Nearly there",
};

export const formatTime = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function Toast({ toast }: { toast: HudState["toast"] }) {
  const [shown, setShown] = useState<HudState["toast"]>(null);
  useEffect(() => {
    if (!toast) {
      setShown(null);
      return;
    }
    setShown(toast);
    const t = window.setTimeout(() => setShown(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);
  if (!shown) return null;
  return (
    <p key={shown.id} className="patch rise px-4 py-2 text-sm font-extrabold">
      {shown.text}
    </p>
  );
}

export function Hud({
  hud,
  onFetch,
  guide,
}: {
  hud: HudState;
  onFetch: (id: ItemId) => void;
  guide?: ReactNode;
}) {
  const g = hud.gust;
  const fetching = useRef<ItemId | null>(null);
  useLayoutEffect(() => {
    if (!fetching.current || hud.dropped.some((d) => d.id === fetching.current)) return;
    fetching.current = null;
    focusHikeControl();
  }, [hud.dropped]);
  return (
    <>
      <header className="hike-hud pointer-events-none">
        <div className="trail-progress patch flex w-full max-w-[560px] items-center gap-3 px-4 py-2">
          <span className="w-24 text-xs font-extrabold sm:w-28 sm:text-sm">
            {ZONE_NAMES[hud.zone]}
          </span>
          <div
            className="relative h-3 flex-1 rounded-full bg-paper-2"
            role="progressbar"
            aria-label="Trail progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hud.progress * 100)}
          >
            <div
              className="h-full rounded-full bg-moss"
              style={{ width: `${hud.progress * 100}%` }}
            />
            {CHECKPOINTS.slice(1).map((c) => (
              <span
                key={c}
                className="absolute top-[-3px] h-[18px] w-[3px] rounded bg-mustard"
                style={{ left: `${(c / TRAIL_LENGTH) * 100}%` }}
              />
            ))}
            {MARKS.map((m) => (
              <span
                key={m.label}
                className="trail-mark-label absolute top-3.5 -translate-x-1/2 text-[10px] font-bold text-ink-soft"
                style={{ left: `${(m.at / TRAIL_LENGTH) * 100}%` }}
              >
                {m.label}
              </span>
            ))}
          </div>
          <span className="w-12 text-right font-mono text-sm font-bold tabular-nums">
            <span className="sr-only">Time </span>
            {formatTime(hud.time)}
          </span>
        </div>
        <TiltMeter tilt={hud.tilt} lean={hud.lean} safe={hud.safe} limit={hud.limit} />
        <div className="hike-alerts flex flex-col items-center gap-2" aria-live="polite">
          {g && (g.warning || g.strength > 0) && (
            <p className="patch px-4 py-2 text-sm font-extrabold text-sky">
              {g.warning ? "Wind whistling…" : "Gust!"} pushing {g.dir > 0 ? "right ▶" : "◀ left"}
            </p>
          )}
          <Toast toast={hud.toast} />
        </div>
      </header>

      <div className="hike-notes">
        {guide}
        {hud.dropped.length > 0 && (
          <aside
            aria-label="Spilled items"
            className="spill-actions keyboard-scroll pointer-events-auto"
          >
            {hud.dropped.map((d) => (
              <button
                key={d.id}
                type="button"
                disabled={hud.busy}
                onClick={() => {
                  fetching.current = d.id;
                  onFetch(d.id);
                }}
                className="fetch-button patch flex min-h-11 items-center gap-2 px-3 py-2 text-left text-xs font-bold disabled:opacity-50"
              >
                <ItemIcon id={d.id} size={24} />
                <span>
                  Fetch {item(d.id).name.toLowerCase()}
                  <span className="block font-semibold text-ink-soft">+{d.cost} s</span>
                </span>
              </button>
            ))}
          </aside>
        )}
      </div>

      <Controls />
    </>
  );
}
