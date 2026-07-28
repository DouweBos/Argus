import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const port = parseInt(process.env.ARGUS_PORT ?? "1420", 10);

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "app"),
      "@logger": path.resolve(__dirname, "app/lib/logger.ts"),
    },
  },
  worker: {
    format: "es",
  },
  clearScreen: false,
  server: {
    port,
    strictPort: true,
    headers: {
      // Required for SharedArrayBuffer / cross-origin isolation.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    outDir: "dist",
    target: "esnext",
  },
});
