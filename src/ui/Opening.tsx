import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { HudState } from "./store";

// The opening title, over the camera's slow push in across the plateau to the trailhead: the
// premise in two lines and one button. (The camera then glides down to the bear to pack.)

export function TitleCard({ onBegin }: { onBegin: () => void }) {
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    go.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="title-screen keyboard-scroll pointer-events-auto fixed inset-0 z-20 flex items-end lg:items-center">
      <div className="title-shade pointer-events-none absolute inset-0" />
      <section
        aria-labelledby="title-name"
        className="title-copy relative flex max-w-[36rem] flex-col gap-4 px-6 pb-10 lg:pb-0 lg:pl-16"
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
    touch: "Hold Walk",
  },
  {
    lead: "The stack sways. Lean against it.",
    more: "When the load tips right, lean left. The meter shows how close it is to going over.",
    keys: "A / ← leans left · D / → leans right",
    touch: "Hold ◀ or ▶ to lean",
  },
  {
    lead: "Let go of Walk to steady the load.",
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

const coarse = () =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
function subscribePointer(listener: () => void) {
  const media = window.matchMedia("(pointer: coarse)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

export function guideText(step: number, hud?: HudState) {
  const base = STEPS[step];
  if (!base) return null;
  if (step === 1 && hud?.stack.length === 0)
    return {
      ...base,
      lead: "Try leaning left or right.",
      more: "Your pack is empty. Practice shifting the bear's balance; a packed stack will follow the same lean.",
    };
  if (step === 2 && hud?.zone === "lane")
    return {
      ...base,
      lead: "Keep moving on Goose Lane.",
      more: "The goose chases a bear that stops. Keep walking and counter the sway until the meter settles into green.",
    };
  if (step === 2 && hud?.stack.length === 0)
    return {
      ...base,
      more: "Let the bear stop and settle. A low, heavy pack sways less; any spills can be fetched back after landing.",
    };
  if (step === 3 && hud?.nextLogDistance === null)
    return {
      ...base,
      lead: "Practice a jump on a clear patch.",
      more: "The logs are behind you. Tap Jump, let go, and land before trying another; hold Walk when you want to jump forward.",
    };
  return base;
}

export function Guide({ step, onSkip, hud }: { step: number; onSkip: () => void; hud?: HudState }) {
  const touch = useSyncExternalStore(subscribePointer, coarse, () => false);
  const reading = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (step >= 0 && reading.current) reading.current.scrollTop = 0;
  }, [step]);
  const s = guideText(step, hud);
  if (!s) return null;
  const how = touch ? s.touch : s.keys;
  return (
    <div className="hike-guide pointer-events-none">
      <div
        ref={reading}
        role="note"
        aria-label="Trail guide"
        aria-live="polite"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The bounded guide must support native keyboard scrolling.
        tabIndex={0}
        className="guide-card keyboard-scroll patch rise pointer-events-auto px-5 py-4"
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
          className="guide-skip mt-2 min-h-11 text-xs font-bold text-ink-soft underline"
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
