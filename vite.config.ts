import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwind()],
  server: { host: "127.0.0.1", port: 4516, strictPort: true },
  preview: { host: "127.0.0.1", port: 4616, strictPort: true },
  build: { cssMinify: "lightningcss" },
});
