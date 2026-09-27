// Studio server: serves the turntable page and assets-src/studio/ for tools/studio/kit/render.mjs.
import { defineConfig } from "vite";

export default defineConfig({
  root: process.cwd(),
  logLevel: "warn",
  server: {
    host: "127.0.0.1",
    port: Number(process.env.STUDIO_PORT ?? 4799),
    strictPort: true,
    watch: { ignored: ["**/assets-src/**", "**/docs/**", "**/dist*/**", "**/output/**"] },
  },
  optimizeDeps: { entries: ["tools/studio/kit/turntable.html"] },
});
