import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/globalSetup.ts"],
    include: ["services/**/*.test.ts", "test/**/*.test.ts"],
    // Repository tests share one database; run files serially to avoid
    // cross-talk between truncations.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
