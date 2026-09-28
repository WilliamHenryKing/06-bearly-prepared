import { useEffect, useRef, useState } from "react";
import { item } from "../game/items";
import { MAX_CIVILITY, type TeaOutcome } from "../game/tea";
import { formatTime } from "./Hud";
import { ItemIcon } from "./ItemIcon";

// The ending: what arrived becomes the scene; the card reads it out and invites another go.

function nextDare(o: TeaOutcome) {
  if (o.silence) return "Next time: save the biscuits.";
  if (o.style === "lounge") return "Utterly civilised. Can you do it faster?";
  if (o.style === "neat") return "Next time: attempt the absurd luxury arrangement.";
  return "Next time: bring the standard lamp. For ambience.";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function summary(t: { spills: number; fetches: number; topples: number }, o: TeaOutcome) {
  const carried = `Carried ${plural(o.arrived.length, "thing", "things")} to the top`;
  if (t.spills === 0 && t.topples === 0) return `${carried} without spilling a thing.`;
  return `${carried}: ${plural(t.spills, "spill", "spills")}, ${plural(t.fetches, "fetch", "fetches")}, ${plural(t.topples, "topple", "topples")}.`;
}

export function TeaCard({
  outcome,
  time,
  tally,
  onReplay,
}: {
  outcome: TeaOutcome;
  time: number;
  tally: { spills: number; fetches: number; topples: number };
  onReplay: () => void;
}) {
  const [ready, setReady] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 1400);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (ready) button.current?.focus({ preventScroll: true });
  }, [ready]);
  if (!ready) return null;
  return (
    <section
      aria-labelledby="tea-title"
      className="patch rise pointer-events-auto absolute inset-x-3 bottom-3 max-h-[50vh] overflow-y-auto p-5 lg:inset-x-auto lg:top-1/2 lg:right-6 lg:bottom-auto lg:max-h-none lg:w-[380px] lg:-translate-y-1/2"
    >
      <p className="text-xs font-extrabold tracking-widest text-ink-soft uppercase">
        At the lookout
      </p>
      <h2 id="tea-title" className="text-2xl font-black">
        {outcome.title}
      </h2>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {outcome.lines.map((l, i) => (
          <li
            key={l}
            className={`rise ${l.includes("silence") ? "font-extrabold italic" : ""}`}
            style={{ animationDelay: `${0.15 * i}s` }}
          >
            {l}
          </li>
        ))}
      </ul>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-paper-2 p-2">
          <dt className="text-xs font-bold text-ink-soft">Time</dt>
          <dd className="font-mono text-lg font-black tabular-nums">{formatTime(time)}</dd>
        </div>
        <div className="rounded-xl bg-paper-2 p-2">
          <dt className="text-xs font-bold text-ink-soft">Civility</dt>
          <dd className="text-lg font-black">
            {outcome.civility} / {MAX_CIVILITY}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs font-bold text-ink-soft">{summary(tally, outcome)}</p>
      {outcome.lost.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-ink-soft">
          Left on the trail:
          {outcome.lost.map((id) => (
            <span key={id} className="inline-flex items-center gap-0.5 font-bold">
              <ItemIcon id={id} size={18} />
              {item(id).name}
            </span>
          ))}
        </p>
      )}
      <p className="mt-3 text-sm font-bold">{nextDare(outcome)}</p>
      <button
        ref={button}
        type="button"
        onClick={onReplay}
        className="wood-btn mt-3 w-full bg-berry py-3 text-lg text-paper hover:bg-berry-dark"
      >
        Pack again
      </button>
    </section>
  );
}
