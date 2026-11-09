import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "packages/client-core/src/**/*.test.ts",
      "packages/host/**/*.test.ts",
      "packages/peacock/src/**/*.test.{ts,tsx}",
      "packages/remote-client/src/**/*.test.ts",
      "packages/remote-protocol/src/**/*.test.ts",
      "clients/argus-web/src/**/*.test.{ts,tsx}",
    ],
    environment: "node",
  },
});
