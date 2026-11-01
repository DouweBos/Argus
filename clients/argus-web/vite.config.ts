import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { webDefines } from "./vite.shared";

export default defineConfig({
  plugins: [react()],
  define: webDefines(),
  // Absolute: screens live at real paths (`/sessions/…`), and the gateway
  // serves index.html for every one of them.
  base: "/",
  build: { outDir: "dist" },
});
