import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  root: fileURLToPath(new URL("./development", import.meta.url)),
  plugins: [react(), tailwind()],
  server: { host: "127.0.0.1", port: 4516, strictPort: true },
  preview: { host: "127.0.0.1", port: 4616, strictPort: true },
  build: { outDir: "../dist-smoke", emptyOutDir: true, cssMinify: "lightningcss" },
});
