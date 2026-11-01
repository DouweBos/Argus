import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { webDefines } from "./vite.shared";

const BASE = "/argus/app/";

/**
 * Subresource Integrity on the entry script and stylesheet. Same-origin, so
 * it mainly pins index.html to the exact bundle it shipped with; chunks
 * loaded by `import()` can't carry it.
 */
function subresourceIntegrity(): Plugin {
  return {
    name: "argus-sri",
    apply: "build",
    // After every file is on disk: vite still rewrites chunks during generateBundle.
    writeBundle(options) {
      const outDir = options.dir!;
      const htmlPath = join(outDir, "index.html");
      const html = readFileSync(htmlPath, "utf8").replace(
        /(<(?:script|link)\b[^>]*?(?:src|href)=")([^"]+)(")/g,
        (tag: string, start: string, url: string, end: string) => {
          if (!url.startsWith(BASE)) {
            return tag;
          }
          const bytes = readFileSync(join(outDir, url.slice(BASE.length)));
          const digest = createHash("sha384").update(bytes).digest("base64");

          return `${start}${url}${end} integrity="sha384-${digest}"`;
        },
      );
      writeFileSync(htmlPath, html);
    },
  };
}

/**
 * The hosted build, served at https://houwert.dev/argus/app/ (copied into
 * houwert.dev by its `pnpm sync:argus-app`). Same components as the LAN
 * build; only the entry differs: it signs in with the Argus account and dials
 * computers over their managed tunnels instead of pairing with its own origin.
 */
export default defineConfig({
  root: resolve(__dirname, "hosted"),
  base: BASE,
  plugins: [react(), subresourceIntegrity()],
  define: webDefines(),
  // The LAN build's service worker is for Web Push, which the hosted client doesn't use.
  publicDir: false,
  build: {
    outDir: resolve(__dirname, "dist-hosted"),
    emptyOutDir: true,
    // Inlined assets would need `data:` in more CSP directives than images and fonts.
    assetsInlineLimit: 0,
  },
});
