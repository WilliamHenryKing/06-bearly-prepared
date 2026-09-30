import { HoldButton } from "./HoldButton";

export function Controls() {
  return (
    <fieldset
      className="hike-controls pointer-events-none"
      aria-label="Hike controls"
      tabIndex={-1}
    >
      <HoldButton k="left" label="Lean left (A or left arrow)" className="bg-sky text-paper">
        <span className="text-2xl leading-none">◀</span>
        <span className="block text-xs">Lean</span>
      </HoldButton>
      <HoldButton
        k="walk"
        label="Walk, hold to keep walking (W or up arrow)"
        className="bg-berry text-paper"
      >
        <span className="text-lg">Walk</span>
        <span className="block text-[11px] font-semibold opacity-80">hold</span>
      </HoldButton>
      <HoldButton k="right" label="Lean right (D or right arrow)" className="bg-sky text-paper">
        <span className="text-2xl leading-none">▶</span>
        <span className="block text-xs">Lean</span>
      </HoldButton>
      <HoldButton k="jump" label="Jump (Space)" className="bg-mustard text-ink">
        <span className="text-2xl leading-none">⤒</span>
        <span className="block text-xs">Jump</span>
      </HoldButton>
    </fieldset>
  );
}
