import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "app"),
      "@logger": path.resolve(__dirname, "app/lib/logger.ts"),
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
