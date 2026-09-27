# BEARLY PREPARED — v1 brief for a cloud build session

You are building this project's v1 in one focused session. Ship a small, polished, complete experience — not a prototype and not a sprawling one. Read this brief once, write a plan of 5–10 lines, then build. Stop when the definition of done is met.

## The idea

**06 — BEARLY PREPARED.** Create an expressive original bear, a small camping prop set and one short trail with three meaningful obstacles. Packing affects load behaviour during traversal. Include readable leaning/balance controls, recoverable spills and a final tea scene that reflects what arrived. Begin with a simple character proxy and three objects to prove control and physical comedy, then bring the animation and artwork to the required quality.

### G3. BEARLY PREPARED

**A physical comedy game about packing far too much for a short hike.**

A small bear is determined to have an extremely civilised cup of tea at a mountain lookout. Its idea of essential equipment includes a kettle, biscuits, a blanket and possibly a standard lamp.

**What you do:** pack a small selection of objects onto the bear's backpack, then guide it along a short trail. The weight distribution and height of the load affect how the stack leans and wobbles.

**First playable moment:** take a corner with a tall, ridiculous load. The kettle slides, the bear glances upwards, and a timely lean keeps everything aboard. Misjudge it and the biscuits tumble into a soft patch of grass.

**Depth:** decide what to carry, place heavy pieces sensibly, control your pace and counterbalance over logs, gusts and narrow sections. Packing is preparation for the actual traversal; the game must not end at arranging items in a grid.

Dropped items can be recovered at a modest cost in time. Checkpoints prevent one silly spill from erasing the whole run.

**Payoff:** the final tea scene uses what actually arrived. A successful minimalist hike produces a neat cup of tea. A ridiculous successful load produces an elaborate little lounge. Missing biscuits receive a solemn moment of silence.

**Why replay:** finish with different loads, save the biscuits or attempt the absurd luxury arrangement.

**Small complete version:** one expressive bear, one trail with three authored obstacles, a small prop set and a two-to-four-minute run.

**Art:** felt, painted wood, brushed ceramic and springy vegetation. Humour should emerge from animation and consequence as much as from written puns.

**What would ruin it:** arbitrary falling, fiddly packing controls, a camera that hides obstacles or a character that lacks expressive timing. This has a higher character-animation burden than the two leading game ideas.

**First proof:** a bear proxy, three objects, one corner and one gust. The load feels understandable and makes the player want another try before any detailed art is added.

Art direction: **BEARLY PREPARED:** tactile felt/clay/painted-wood character work with expressive weight and comic timing.

## Definition of done (v1)

1. One focused scene delivering the idea above, with a complete loop: start → core interaction → a visible result or ending → replay. A short first-time hint teaches the controls in place.
2. Arrival loader: keep the veil in `index.html` and `src/loader.ts`; restyle the veil to the art direction and call `worldReady()` after the first rendered frame.
3. Desktop (1440×900) and phone (390×844) layouts; mouse, touch and keyboard; honour `prefers-reduced-motion`; visible focus and labelled controls.
4. `bun run check` passes: strict `tsc`, Biome, `bun test`, production build into `dist/`.
5. Unit tests of the game rules (pure TypeScript, no DOM) replace `tests/scaffold.test.ts`.
6. `README.md`: one status paragraph, how to play, and credits for any asset used.
No extra modes, settings screens, accounts, leaderboards, backends, analytics or network calls.

## Technical rules

- The stack is installed and pinned: Vite, React, strict TypeScript, three.js 0.186 (direct, no React Three Fiber), GSAP, Tailwind v4, Biome, Bun. Add a dependency only if essential, pinned exactly.
- `bun run dev` serves the real app (`index.html` → `src/main.tsx`); `bun run build` builds it into `dist/`. `development/` is old tooling: leave it alone.
- Single responsibility: `src/game/` pure rules and state (tested), `src/scene/` three.js scene, camera, lights and meshes, `src/ui/` React HUD and panels, `src/main.tsx` wiring. Files under ~300 lines.
- Visuals: author forms procedurally in code (geometry, instancing, small shaders where they clearly help), AgX or ACES tone mapping, one key light plus hemisphere or environment light, soft shadows where cheap, a cohesive palette and strong silhouettes. Type: a system font stack. External assets only if CC0 or public domain, with the source in README.
- Performance: 60 fps on a mid laptop; cap devicePixelRatio at 2.
- Do not change `wrangler.jsonc`, deploy or publish anything.

## Working method

- There is no GPU here. Do not loop on screenshots: at most two headless checks (desktop, phone) if Chromium is available (software WebGL is fine).
- Commit in small, clear steps. Finish with a message: what was built, how to play, known gaps.
