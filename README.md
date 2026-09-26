# BEARLY PREPARED

Status: planned; isolated development environment. No project artwork or features implemented yet.

Working checkout: `experiences/06-bearly-prepared`. Repository anchor: `.repositories/06-bearly-prepared`. Branch: `work/experience`. Preserve both directories.

## Development

```powershell
bun install --frozen-lockfile
bun run dev
bun run check
bun run preview
```

Development: http://127.0.0.1:4516/
Preview: http://127.0.0.1:4616/

The current dev/build scripts run a **development-only smoke harness** in `development/`; output is `dist-smoke/`. It verifies React, Three.js, GSAP and CSS tooling. It is not a portfolio page. Creative production will add the real source and a production build in `dist/`.

Each project owns its dependencies and lockfile. Tailwind uses its Vite plugin; Lightning CSS performs final CSS minification. No shared visual runtime or sibling imports.

Read the collection plan for this project's full creative and completion requirements. Design and asset documents are created when its serial production turn begins. All commercial content will be fictional and local-only.
