import { useLayoutEffect, useSyncExternalStore } from "react";
import type { ItemId } from "../game/items";
import { focusHikeControl, focusPacking } from "./focus";
import { Hud } from "./Hud";
import { MuteButton } from "./MuteButton";
import { Guide, GuideButton, TitleCard } from "./Opening";
import { PackPanel } from "./PackPanel";
import { store } from "./store";
import { TeaCard } from "./TeaCard";

export interface Actions {
  toggle: (id: ItemId) => void;
  move: (index: number, dir: 1 | -1) => void;
  begin: () => void;
  start: () => void;
  fetch: (id: ItemId) => void;
  replay: () => void;
  skipGuide: () => void;
  showGuide: () => void;
}

export function App({ actions }: { actions: Actions }) {
  const hud = useSyncExternalStore(store.subscribe, store.get);
  const opening = hud?.opening;
  const phase = hud?.phase;
  useLayoutEffect(() => {
    if (opening !== "done") return;
    if (phase === "packing") focusPacking();
    else if (phase === "hiking") focusHikeControl();
  }, [opening, phase]);
  if (!hud) return null;
  return (
    <main
      className="bear-ui pointer-events-none fixed inset-0 select-none"
      aria-label="Bearly Prepared"
      data-phase={hud.phase}
      data-opening={hud.opening}
    >
      {hud.opening === "title" && <TitleCard onBegin={actions.begin} />}
      {hud.phase === "packing" && hud.opening === "done" && (
        <PackPanel
          packed={hud.packed}
          stats={hud.stats}
          onToggle={actions.toggle}
          onMove={actions.move}
          onStart={actions.start}
        />
      )}
      {hud.phase === "hiking" && (
        <Hud
          hud={hud}
          onFetch={actions.fetch}
          guide={
            hud.guide >= 0 ? (
              <Guide
                step={hud.guide}
                hud={hud}
                onSkip={() => {
                  actions.skipGuide();
                  focusHikeControl();
                }}
              />
            ) : null
          }
        />
      )}
      {hud.phase === "hiking" && (
        <GuideButton
          onClick={() => {
            actions.showGuide();
            focusHikeControl();
          }}
        />
      )}
      {hud.phase === "tea" && hud.outcome && (
        <TeaCard
          outcome={hud.outcome}
          time={hud.time}
          tally={hud.tally}
          onReplay={actions.replay}
        />
      )}
      {hud.opening === "done" && hud.phase !== "tea" && <MuteButton />}
    </main>
  );
}
