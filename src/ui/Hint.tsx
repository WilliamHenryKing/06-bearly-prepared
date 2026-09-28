import { useEffect, useRef } from "react";

// First-time hint, shown in place over the trail. Dismissed by the button or by walking.

const KEY = "bearly-prepared:hinted";

export function hasSeenHint() {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markHintSeen() {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    // Storage unavailable: the hint simply shows again next time.
  }
}

export function Hint({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      role="dialog"
      aria-labelledby="hint-title"
      className="patch rise pointer-events-auto absolute top-1/2 left-1/2 w-[min(340px,calc(100vw-32px))] -translate-x-1/2 -translate-y-[70%] p-5"
    >
      <h2 id="hint-title" className="text-lg font-black">
        Carrying it all
      </h2>
      <ul className="mt-2 flex flex-col gap-1.5 text-sm">
        <li>
          <b>Hold Walk</b> (W or ↑) to walk. Let go to stop.
        </li>
        <li>
          <b>Lean</b> (A/← or D/→) pushes the load that way. When it tips right, lean left. On a
          hillside, lean uphill.
        </li>
        <li>
          <b>Jump</b> (Space) the logs with a run-up, or trip over them.
        </li>
        <li>
          On the green, wait for a gap: nobody there is looking up from their phone. In the orchard,
          lean the stack away from low branches. Then do not stop for the goose.
        </li>
        <li>Spilled something? Fetch it for a few seconds. Flags save your load.</li>
      </ul>
      <button
        ref={ref}
        type="button"
        onClick={onClose}
        className="wood-btn mt-4 w-full bg-mustard py-2.5 text-ink"
      >
        Off we go
      </button>
    </div>
  );
}
