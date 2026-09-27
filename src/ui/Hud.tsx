import { useEffect, useState } from "react";
import { type ItemId, item } from "../game/items";
import { CHECKPOINTS, LEDGE, LOGS, TRAIL_LENGTH } from "../game/trail";
import { Controls } from "./Controls";
import { ItemIcon } from "./ItemIcon";
import type { HudState } from "./store";
import { TiltMeter } from "./TiltMeter";

// The hike: trail progress with its three obstacles, the load gauge, gust warnings,
// spilled items waiting to be fetched and the hold-to-act controls.

const MARKS = [
  { at: 22, label: "Hairpin" },
  { at: (LOGS[0]?.at ?? 47) + 6, label: "Logs" },
  { at: (LEDGE.from + LEDGE.to) / 2, label: "Ledge" },
];

const ZONE_NAMES: Record<HudState["zone"], string> = {
  meadow: "Meadow path",
  hairpin: "The hairpin",
  logs: "Log steps",
  ledge: "Windy ledge",
  lookout: "Nearly there",
};

export const formatTime = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function Toast({ toast }: { toast: HudState["toast"] }) {
  const [shown, setShown] = useState<HudState["toast"]>(null);
  useEffect(() => {
    if (!toast) return;
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

export function Hud({ hud, onFetch }: { hud: HudState; onFetch: (id: ItemId) => void }) {
  const g = hud.gust;
  return (
    <>
      <header className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-2 p-3 pt-[max(12px,env(safe-area-inset-top))] pl-16 md:pl-3">
        <div className="patch flex w-full max-w-[560px] items-center gap-3 px-4 py-2">
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
                className="absolute top-3.5 -translate-x-1/2 text-[10px] font-bold text-ink-soft"
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
        <div className="flex flex-col items-center gap-2" aria-live="polite">
          {g && (g.warning || g.strength > 0) && (
            <p className="patch px-4 py-2 text-sm font-extrabold text-sky">
              {g.warning ? "Wind whistling…" : "Gust!"} pushing {g.dir > 0 ? "right ▶" : "◀ left"}
            </p>
          )}
          <Toast toast={hud.toast} />
        </div>
      </header>

      {hud.dropped.length > 0 && (
        <aside
          aria-label="Spilled items"
          className="pointer-events-auto absolute inset-x-3 bottom-[108px] flex flex-wrap justify-center gap-2"
        >
          {hud.dropped.map((d) => (
            <button
              key={d.id}
              type="button"
              disabled={hud.busy}
              onClick={() => onFetch(d.id)}
              className="patch flex items-center gap-2 px-3 py-2 text-left text-xs font-bold disabled:opacity-50"
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

      <Controls />
    </>
  );
}
