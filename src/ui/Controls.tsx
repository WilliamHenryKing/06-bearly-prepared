import { useState } from "react";
import { setTouch } from "./input";

// Big hold-to-act buttons for mouse and touch. They mirror the keyboard (A/← lean left,
// W/↑/Space walk, D/→ lean right) and stay pressed while the pointer is held.

type Key = "left" | "walk" | "right";

function HoldButton({
  k,
  label,
  children,
  className,
}: {
  k: Key;
  label: string;
  children: React.ReactNode;
  className: string;
}) {
  const [held, setHeld] = useState(false);
  const set = (down: boolean) => {
    setHeld(down);
    setTouch(k, down);
  };
  return (
    <button
      type="button"
      aria-label={label}
      data-held={held}
      data-game-key="true"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          set(true);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter" || e.key === " ") set(false);
      }}
      onBlur={() => held && set(false)}
      onContextMenu={(e) => e.preventDefault()}
      className={`wood-btn pointer-events-auto touch-none select-none ${className}`}
    >
      {children}
    </button>
  );
}

export function Controls() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:justify-center sm:gap-6">
      <HoldButton
        k="left"
        label="Lean left (A or left arrow)"
        className="h-20 w-24 bg-sky text-paper sm:w-28"
      >
        <span className="text-2xl leading-none">◀</span>
        <span className="block text-xs">Lean</span>
      </HoldButton>
      <HoldButton
        k="walk"
        label="Walk, hold to keep walking (W, up arrow or Space)"
        className="h-20 flex-1 bg-berry text-paper sm:w-44 sm:flex-none"
      >
        <span className="text-lg">Walk</span>
        <span className="block text-[11px] font-semibold opacity-80">hold</span>
      </HoldButton>
      <HoldButton
        k="right"
        label="Lean right (D or right arrow)"
        className="h-20 w-24 bg-sky text-paper sm:w-28"
      >
        <span className="text-2xl leading-none">▶</span>
        <span className="block text-xs">Lean</span>
      </HoldButton>
    </div>
  );
}
