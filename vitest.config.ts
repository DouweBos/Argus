import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "app"),
      "@logger": path.resolve(__dirname, "app/lib/logger.ts"),
      // Main-process unit tests transitively value-import `electron`, whose real
      // entry point throws when the binary isn't resolvable in a plain Node/CI
      // context (notably Windows). Stub it so tests don't need the runtime.
      electron: path.resolve(__dirname, "test/electron-stub.ts"),
    },
  },
  test: {
    globals: true,
    include: ["app/**/*.test.{ts,tsx}", "electron/**/*.test.ts"],
    environment: "node",
    environmentMatchGlobs: [
      // Frontend tests that need DOM
      ["app/**/*.test.tsx", "jsdom"],
    ],
  },
});
