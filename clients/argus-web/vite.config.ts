import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Absolute: screens live at real paths (`/sessions/…`), and the gateway
  // serves index.html for every one of them.
  base: "/",
  build: { outDir: "dist" },
});
