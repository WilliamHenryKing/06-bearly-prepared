import { defineConfig, devices } from "@playwright/test";

// One end-to-end run: pack a sensible load and walk it to the lookout. Headless Chromium with
// SwiftShader is enough. Set PLAYWRIGHT_CHROMIUM to use a specific Chromium binary.

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 360_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4616",
    viewport: { width: 560, height: 380 },
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 560, height: 380 },
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
          args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        },
      },
    },
  ],
  webServer: {
    command: "bun run build && bun run preview",
    url: "http://127.0.0.1:4616",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
