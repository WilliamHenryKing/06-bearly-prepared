import { useEffect, useRef } from "react";

// The opening title, over the camera's slow push in across the plateau to the trailhead: the
// premise in two lines and one button. (The camera then glides down to the bear to pack.)

export function TitleCard({ onBegin }: { onBegin: () => void }) {
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    go.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="pointer-events-auto fixed inset-0 z-20 flex items-end lg:items-center">
      <div className="title-shade pointer-events-none absolute inset-0" />
      <section
        aria-labelledby="title-name"
        className="relative flex max-w-[36rem] flex-col gap-4 px-6 pb-10 lg:pb-0 lg:pl-16"
      >
        <p className="rise text-[11px] font-extrabold uppercase tracking-[0.3em] text-berry">
          A short hike · an absurd load
        </p>
        <h1
          id="title-name"
          className="rise m-0 text-5xl leading-[0.98] font-black tracking-tight text-balance sm:text-7xl"
        >
          Bearly Prepared
        </h1>
        <p className="rise m-0 max-w-[31rem] text-base leading-relaxed text-ink sm:text-lg">
          Tea at the lookout, up past the village green, the orchard and Goose Lane. Everything you
          pack rides on the bear's back, first item at the bottom, and the stack has opinions.
        </p>
        <div className="rise flex flex-wrap items-center gap-3">
          <button
            ref={go}
            type="button"
            onClick={onBegin}
            className="wood-btn bg-berry px-7 py-3 text-lg text-paper"
          >
            Begin
          </button>
          <span className="hidden text-xs text-ink-soft sm:inline">or press Enter</span>
        </div>
      </section>
    </div>
  );
}

/** The guided first minute: each step waits for the player (main.tsx moves it on). */
const STEPS: { lead: string; more: string; keys: string; touch: string }[] = [
  {
    lead: "Hold Walk to set off.",
    more: "Let go and the bear stops.",
    keys: "W or ↑ walks",
    touch: "Hold the middle button",
  },
  {
    lead: "The stack sways. Lean against it.",
    more: "When the load tips right, lean left. The meter shows how close it is to going over.",
    keys: "A / ← leans left · D / → leans right",
    touch: "Hold ◀ or ▶ to lean",
  },
  {
    lead: "Heavy and low sways least.",
    more: "Stopping steadies the stack. Anything that falls can be fetched back, for a few seconds.",
    keys: "",
    touch: "",
  },
  {
    lead: "A log across the path.",
    more: "Jump a stride before it. Too early or too late and the bear trips, and the load goes flying.",
    keys: "Space jumps",
    touch: "Tap Jump",
  },
];

export function Guide({ step, onSkip }: { step: number; onSkip: () => void }) {
  const s = STEPS[step];
  if (!s) return null;
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const how = touch ? s.touch : s.keys;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(4.5rem+env(safe-area-inset-top))] flex justify-center px-3 lg:top-auto lg:bottom-6 lg:left-6 lg:justify-start">
      <div
        key={step}
        role="note"
        aria-live="polite"
        className="patch rise pointer-events-auto w-[min(360px,calc(100vw-24px))] px-5 py-4"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-ink-soft">
            On the trail · {step + 1} of {STEPS.length}
          </span>
          <span className="flex gap-1" aria-hidden="true">
            {STEPS.map((x, i) => (
              <span
                key={x.lead}
                className={`h-1.5 w-4 rounded-full ${i <= step ? "bg-berry" : "bg-paper-2"}`}
              />
            ))}
          </span>
        </div>
        <p className="m-0 mt-1.5 text-lg leading-tight font-black">{s.lead}</p>
        <p className="m-0 mt-1 text-sm leading-snug">{s.more}</p>
        {how && <p className="m-0 mt-1 text-xs font-bold text-ink-soft">{how}</p>}
        <button
          type="button"
          onClick={onSkip}
          className="mt-2 text-xs font-bold text-ink-soft underline"
        >
          Skip the guide
        </button>
      </div>
    </div>
  );
}

/** Replays the guide during the hike. */
export function GuideButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="How to play: replay the guide"
      title="How to play"
      className="patch pointer-events-auto absolute top-3 left-16 mt-[env(safe-area-inset-top)] flex h-11 w-11 items-center justify-center text-lg font-black text-ink"
    >
      ?
    </button>
  );
}
