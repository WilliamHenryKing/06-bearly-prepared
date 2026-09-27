# BEARLY PREPARED

Status: v1 playable. A small felt bear packs far too much for a short hike to a lookout, then
has exactly the tea that survived the trip. One trail with three authored obstacles (a hairpin,
log steps and a windy ledge), a six-piece prop set, balance you can read and steer, recoverable
spills, checkpoint flags and a tea scene built from what arrived. Everything is drawn
procedurally in code; there are no external assets, network calls or accounts.

## How to play

1. **Pack.** Tap props to add them to the top of the stack; reorder with ▲ ▼. Heavy and low
   sways least, tall loads swing wide, and whatever sits on the blanket grips better.
2. **Walk.** Hold **Walk** (W, ↑ or Space). Let go to stop. Heavier loads walk slower.
3. **Lean.** Hold **◀ Lean / Lean ▶** (A/← and D/→). Leaning pushes the load that way, so when
   the gauge tips right, lean left. Green on the gauge means nothing slides; amber means the
   loosest item is sliding; red is a topple. The bear glances up and reaches for anything that
   starts to go.
4. **Obstacles.** The hairpin throws the load outward, each log lurches it toward its low end
   (the stone shows which), and the ledge gusts on a rhythm: a whistle, a push, a lull. The
   ledge is narrower, so it topples sooner.
5. **Spills.** Items that slide off land in the grass. Fetch them for a few seconds each. A
   topple sends you back to the last flag with the load you had there (+4 s).
6. **Tea.** At the lookout the bear unpacks what arrived: a neat cup, a respectable picnic or an
   elaborate little lounge. Missing biscuits receive a moment of silence. Then pack again.

Mouse, touch and keyboard all work; `prefers-reduced-motion` calms the camera, pops and grass.

## Development

```sh
bun install --frozen-lockfile
bun run dev      # http://127.0.0.1:4516/
bun run check    # tsc, Biome, bun test, production build into dist/
bun run preview  # http://127.0.0.1:4616/
```

Source layout: `src/game/` pure rules (tested in `tests/rules.test.ts`), `src/scene/` three.js
scene, `src/ui/` React HUD, `src/main.tsx` wiring, `src/loader.ts` arrival veil.
`development/` and `tools/studio/` are earlier tooling and not part of the app.

## Credits

All geometry, materials, textures and animation are authored procedurally in this
repository. Libraries: three.js, React, GSAP, Tailwind CSS (all under their own licences). No
third-party art assets are used.
