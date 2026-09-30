import { useLayoutEffect, useRef, useState } from "react";
import { ITEM_ORDER, type ItemId, item } from "../game/items";
import type { LoadStats } from "../game/load";
import { MAX_STACK } from "../game/run";
import { ItemIcon } from "./ItemIcon";

// Packing: tap props to add them to the top of the stack, reorder with the arrows.
// The load card reads out what the stack will do on the trail before you set off.

interface Props {
  packed: ItemId[];
  stats: LoadStats;
  onToggle: (id: ItemId) => void;
  onMove: (index: number, dir: 1 | -1) => void;
  onStart: () => void;
}

const WOBBLE_WORDS = ["Steady", "Jaunty", "Wobbly", "Precarious", "Magnificently unwise"];

export function PackPanel({ packed, stats, onToggle, onMove, onStart }: Props) {
  const word = WOBBLE_WORDS[Math.min(4, Math.floor(stats.wobble * 5))];
  const topHeavy = packed.length > 1 && stats.comHeight > 0.5 + stats.height * 0.55;
  const panel = useRef<HTMLElement>(null);
  const moving = useRef<{ id: ItemId; dir: 1 | -1 } | null>(null);
  const [announcement, announce] = useState("");
  useLayoutEffect(() => {
    const requested = moving.current;
    if (!requested) return;
    moving.current = null;
    const controls = panel.current?.querySelectorAll<HTMLButtonElement>(
      `[data-stack-item="${requested.id}"]`,
    );
    const next =
      controls &&
      [...controls].find(
        (button) => button.dataset.direction === String(requested.dir) && !button.disabled,
      );
    const fallback = controls && [...controls].find((button) => !button.disabled);
    const target =
      next ??
      fallback ??
      panel.current?.querySelector<HTMLButtonElement>(`[data-kit-item="${requested.id}"]`);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    announce(
      `${item(requested.id).name} is now ${packed.indexOf(requested.id) + 1} of ${packed.length}, counted from the bottom.`,
    );
  }, [packed]);
  const move = (id: ItemId, index: number, dir: 1 | -1) => {
    moving.current = { id, dir };
    onMove(index, dir);
  };
  return (
    <section
      ref={panel}
      aria-labelledby="pack-title"
      tabIndex={-1}
      className="pack-panel keyboard-scroll patch rise pointer-events-auto absolute inset-x-3 bottom-3 max-h-[52vh] overflow-y-auto p-4 sm:p-5 lg:inset-x-auto lg:top-4 lg:right-4 lg:bottom-4 lg:max-h-none lg:w-[380px]"
    >
      <h1 id="pack-title" className="text-xl font-black tracking-tight sm:text-2xl">
        Bearly Prepared
      </h1>
      <p className="mt-1 text-sm text-ink-soft">
        Tea at the lookout. Pack what matters: the stack goes on your back, first item at the
        bottom.
      </p>

      <h2 className="mt-4 text-xs font-extrabold tracking-widest text-ink-soft uppercase">
        The kit
      </h2>
      <ul className="mt-2 grid grid-cols-3 gap-2">
        {ITEM_ORDER.map((id) => {
          const on = packed.includes(id);
          const def = item(id);
          return (
            <li key={id}>
              <button
                type="button"
                data-kit-item={id}
                aria-label={def.name}
                aria-describedby={`kit-${id}-stats`}
                aria-pressed={on}
                disabled={!on && packed.length >= MAX_STACK}
                onClick={() => onToggle(id)}
                className={`flex w-full flex-col items-center rounded-2xl border-2 px-1 py-2 text-xs font-bold transition-colors ${
                  on
                    ? "border-ink bg-mustard/40"
                    : "border-transparent bg-paper-2 hover:border-stitch"
                }`}
              >
                <ItemIcon id={id} />
                <span className="mt-1 leading-tight">{def.name}</span>
                <span id={`kit-${id}-stats`} className="font-semibold text-[10px] text-ink-soft">
                  {def.weight} kg · {Math.round(def.height * 100)} cm
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <h2 className="mt-4 text-xs font-extrabold tracking-widest text-ink-soft uppercase">
        The stack <span className="font-semibold normal-case tracking-normal">(top first)</span>
      </h2>
      {packed.length === 0 ? (
        <p className="mt-2 rounded-xl bg-paper-2 p-3 text-sm">
          Nothing packed. A bold, minimalist choice.
        </p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1">
          {[...packed].reverse().map((id, r) => {
            const i = packed.length - 1 - r;
            const name = item(id).name;
            return (
              <li key={id} className="flex items-center gap-2 rounded-xl bg-paper-2 px-2 py-1">
                <ItemIcon id={id} size={22} />
                <span className="flex-1 text-sm font-bold">{name}</span>
                <span className="hidden text-[11px] text-ink-soft sm:inline">{item(id).blurb}</span>
                <button
                  type="button"
                  data-stack-item={id}
                  data-direction="1"
                  aria-label={`Move ${name} up`}
                  disabled={i === packed.length - 1}
                  onClick={() => move(id, i, 1)}
                  className="pack-reorder h-11 w-11 shrink-0 rounded-lg font-black hover:bg-paper disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  type="button"
                  data-stack-item={id}
                  data-direction="-1"
                  aria-label={`Move ${name} down`}
                  disabled={i === 0}
                  onClick={() => move(id, i, -1)}
                  className="pack-reorder h-11 w-11 shrink-0 rounded-lg font-black hover:bg-paper disabled:opacity-30"
                >
                  ▼
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="mt-4 rounded-2xl bg-paper-2 p-3" aria-live="polite">
        <div className="flex items-baseline justify-between text-sm font-bold">
          <span>Load: {word}</span>
          <span className="text-ink-soft">{stats.height.toFixed(2)} m tall</span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-paper" aria-hidden="true">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(6, stats.wobble * 100)}%`,
              background:
                stats.wobble > 0.6 ? "#c84b3c" : stats.wobble > 0.3 ? "#d9a441" : "#4f7a58",
            }}
          />
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          {topHeavy
            ? "Top-heavy: heavy things low will sway less."
            : packed.includes("blanket")
              ? "Whatever sits on the blanket grips better."
              : "Heavy and low sways least. Tall loads swing wide on corners."}
        </p>
      </div>

      <button
        type="button"
        onClick={onStart}
        className="wood-btn sticky bottom-0 mt-4 w-full bg-berry py-3 text-lg text-paper hover:bg-berry-dark"
      >
        Set off
      </button>
    </section>
  );
}
