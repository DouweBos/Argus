import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative base so the bundle works when served from the gateway root.
  base: "./",
  build: { outDir: "dist" },
});
