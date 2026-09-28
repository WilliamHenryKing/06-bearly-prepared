import { defineConfig, devices } from "@playwright/test";

// One end-to-end run: pack a sensible load and walk it to the lookout. Headless Chromium on
// SwiftShader by default (set PLAYWRIGHT_CHROMIUM to use a specific binary); E2E_GPU=1 runs
// installed Chrome on the real GPU, which a machine with one should use: the furred bear and
// the scanned meadow run far below real time in software rendering.

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
        launchOptions: process.env.E2E_GPU
          ? { channel: "chrome", args: ["--use-angle=d3d11", "--enable-gpu"] }
          : {
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
