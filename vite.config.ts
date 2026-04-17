import importMetaUrlPlugin from "@codingame/esbuild-import-meta-url-plugin";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { type Plugin, defineConfig } from "vite";

const port = parseInt(process.env.ARGUS_PORT ?? "1420", 10);

/**
 * Plugin that resolves relative CSS imports from VS Code / monaco-vscode-api
 * packages to the correct absolute paths. Without this, the bundler fails
 * on `./media/actions.css` style imports.
 */
function vscodeCssResolverPlugin(): Plugin {
  return {
    name: "vscode-css-resolver",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!importer || !source.endsWith(".css")) {
        return null;
      }

      // Only handle relative imports from within the monaco-vscode-api tree
      if (!source.startsWith("./") && !source.startsWith("../")) {
        return null;
      }

      if (
        importer.includes("@codingame/monaco-vscode") ||
        importer.includes("monaco-vscode-api")
      ) {
        const resolved = path.resolve(path.dirname(importer), source);

        return resolved;
      }

      return null;
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react(), vscodeCssResolverPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "app"),
      "@logger": path.resolve(__dirname, "app/lib/logger.ts"),
      // Alias monaco-editor to the @codingame wrapper
      "monaco-editor": path.resolve(
        __dirname,
        "node_modules/@codingame/monaco-vscode-editor-api",
      ),
      vscode: path.resolve(
        __dirname,
        "node_modules/@codingame/monaco-vscode-extension-api",
      ),
    },
    dedupe: ["@codingame/monaco-vscode-api"],
  },
  optimizeDeps: {
    include: [
      "@codingame/monaco-vscode-editor-api",
      "@codingame/monaco-vscode-api",
      "@codingame/monaco-vscode-views-service-override",
      "@codingame/monaco-vscode-configuration-service-override",
      "@codingame/monaco-vscode-keybindings-service-override",
      "@codingame/monaco-vscode-files-service-override",
      "@codingame/monaco-vscode-textmate-service-override",
      "@codingame/monaco-vscode-theme-service-override",
      "@codingame/monaco-vscode-languages-service-override",
      "@codingame/monaco-vscode-extensions-service-override",
      "@codingame/monaco-vscode-explorer-service-override",
      "@codingame/monaco-vscode-search-service-override",
      "@codingame/monaco-vscode-model-service-override",
      "@codingame/monaco-vscode-quickaccess-service-override",
    ],
    esbuildOptions: {
      plugins: [importMetaUrlPlugin],
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
      // Required for SharedArrayBuffer (used by language-features extensions)
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    outDir: "dist",
    target: "esnext",
  },
});
