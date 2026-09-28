import { useSyncExternalStore } from "react";
import type { ItemId } from "../game/items";
import { Hint } from "./Hint";
import { Hud } from "./Hud";
import { MuteButton } from "./MuteButton";
import { PackPanel } from "./PackPanel";
import { store } from "./store";
import { TeaCard } from "./TeaCard";

export interface Actions {
  toggle: (id: ItemId) => void;
  move: (index: number, dir: 1 | -1) => void;
  start: () => void;
  fetch: (id: ItemId) => void;
  replay: () => void;
  closeHint: () => void;
}

export function App({ actions }: { actions: Actions }) {
  const hud = useSyncExternalStore(store.subscribe, store.get);
  if (!hud) return null;
  return (
    <main className="pointer-events-none fixed inset-0 select-none" aria-label="Bearly Prepared">
      {hud.phase === "packing" && (
        <PackPanel
          packed={hud.packed}
          stats={hud.stats}
          onToggle={actions.toggle}
          onMove={actions.move}
          onStart={actions.start}
        />
      )}
      {hud.phase === "hiking" && <Hud hud={hud} onFetch={actions.fetch} />}
      {hud.phase === "hiking" && hud.hint && <Hint onClose={actions.closeHint} />}
      {hud.phase === "tea" && hud.outcome && (
        <TeaCard
          outcome={hud.outcome}
          time={hud.time}
          tally={hud.tally}
          onReplay={actions.replay}
        />
      )}
      <MuteButton />
    </main>
  );
}
