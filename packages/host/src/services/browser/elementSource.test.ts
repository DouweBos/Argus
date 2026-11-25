import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appFrame,
  parseLocation,
  relativeToWorktree,
  resolveElementSource,
  type SourceContext,
  sourceFromAttributes,
  sourcePath,
} from "./elementSource";

const fixtures = path.join(import.meta.dirname, "fixtures");
const worktree = path.join(os.tmpdir(), `element-source-${process.pid}`);

const page = "http://localhost:5173/";

function context(files: Record<string, string> = {}): SourceContext & {
  fetched: string[];
} {
  const fetched: string[] = [];

  return {
    pageUrl: page,
    worktree,
    fetched,
    fetchText: async (url) => {
      fetched.push(url);

      return files[url] ?? null;
    },
  };
}

// React 19's `_debugStack` for a <button> in SaveButton, served by Vite.
const reactStack = [
  "Error: react-stack-top-frame",
  "    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1a2b:250:30)",
  "    at SaveButton (http://localhost:5173/assets/SaveButton.js?t=1700000000:5:26)",
  "    at renderWithHooks (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=1a2b:4001:20)",
].join("\n");

describe("element source", () => {
  beforeAll(() => {
    fs.mkdirSync(path.join(worktree, "apps/web/src"), { recursive: true });
    fs.writeFileSync(path.join(worktree, "apps/web/src/SaveButton.tsx"), "");
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.writeFileSync(path.join(worktree, "src/Card.vue"), "");
  });
  afterAll(() => fs.rmSync(worktree, { recursive: true, force: true }));

  describe("framework hints", () => {
    it("parses file:line:column and a bare path", () => {
      expect(parseLocation("src/App.vue:12:5")).toEqual({
        file: "src/App.vue",
        line: 12,
      });
      expect(parseLocation("src/App.vue")).toEqual({
        file: "src/App.vue",
        line: undefined,
      });
    });

    it("reads the dev plugins' attributes", () => {
      expect(
        sourceFromAttributes({
          "data-inspector-relative-path": "src/Nav.tsx",
          "data-inspector-line": "18",
        }),
      ).toEqual({ file: "src/Nav.tsx", line: 18 });
      expect(
        sourceFromAttributes({ "data-v-inspector": "src/Card.vue:7:3" }),
      ).toEqual({ file: "src/Card.vue", line: 7 });
      expect(sourceFromAttributes({ "data-locator": "src/a.tsx:4" })).toEqual({
        file: "src/a.tsx",
        line: 4,
      });
      expect(sourceFromAttributes({ "data-testid": "x" })).toBeNull();
    });

    it("prefers React's dev source and keeps the component", async () => {
      const resolved = await resolveElementSource(
        {
          react: {
            component: "SaveButton",
            fileName: path.join(worktree, "apps/web/src/SaveButton.tsx"),
            lineNumber: 9,
            stack: reactStack,
          },
        },
        context(),
      );
      expect(resolved).toEqual({
        framework: "react",
        component: "SaveButton",
        source: "apps/web/src/SaveButton.tsx:9",
        method: "react",
      });
    });

    it("reads Vue's component file, named after it when anonymous", async () => {
      const resolved = await resolveElementSource(
        { vue: { file: path.join(worktree, "src/Card.vue") } },
        context(),
      );
      expect(resolved).toEqual({
        framework: "vue",
        component: "Card",
        source: "src/Card.vue",
        method: "vue",
      });
    });

    it("prefers a dev plugin's line over Vue's bare file", async () => {
      const resolved = await resolveElementSource(
        {
          vue: { component: "Card", file: "src/Card.vue" },
          attributes: { "data-v-inspector": "src/Card.vue:7:3" },
        },
        context(),
      );
      expect(resolved.source).toBe("src/Card.vue:7");
      expect(resolved.method).toBe("attribute");
    });

    it("turns Svelte 4's zero-based line one-based", async () => {
      const svelte4 = await resolveElementSource(
        { svelte: { file: "src/Card.vue", line: 6, zeroBased: true } },
        context(),
      );
      expect(svelte4.source).toBe("src/Card.vue:7");
      const svelte5 = await resolveElementSource(
        { svelte: { file: "src/Card.vue", line: 7 } },
        context(),
      );
      expect(svelte5).toMatchObject({
        source: "src/Card.vue:7",
        method: "svelte",
      });
    });

    it("says none with nothing to go on", async () => {
      await expect(resolveElementSource(undefined, context())).resolves.toEqual(
        {
          method: "none",
        },
      );
    });
  });

  describe("stacks and source maps", () => {
    it("skips React's and the dependencies' frames", () => {
      expect(appFrame(reactStack)).toEqual({
        url: "http://localhost:5173/assets/SaveButton.js?t=1700000000",
        line: 5,
        column: 26,
      });
      expect(appFrame("Error\n    at <anonymous>")).toBeNull();
    });

    it("maps React 19's stack through the dev server's map", async () => {
      const script = "http://localhost:5173/assets/SaveButton.js?t=1700000000";
      const ctx = context({
        [script]: fs.readFileSync(
          path.join(fixtures, "SaveButton.js.txt"),
          "utf-8",
        ),
        "http://localhost:5173/assets/SaveButton.js.map": fs.readFileSync(
          path.join(fixtures, "SaveButton.js.map"),
          "utf-8",
        ),
      });
      const resolved = await resolveElementSource(
        { react: { component: "SaveButton", stack: reactStack } },
        ctx,
      );
      // The map says `/src/SaveButton.tsx`; the dev server is rooted in apps/web.
      expect(resolved).toEqual({
        framework: "react",
        component: "SaveButton",
        source: "apps/web/src/SaveButton.tsx:9",
        method: "sourcemap",
      });
    });

    it("never fetches from another origin", async () => {
      const ctx = context();
      const resolved = await resolveElementSource(
        {
          react: {
            stack: "Error\n    at X (http://evil.example/x.js:1:1)",
          },
        },
        ctx,
      );
      expect(resolved.method).toBe("none");
      expect(ctx.fetched).toEqual([]);
    });

    it("reads bundler and dev-server source names as project paths", () => {
      expect(sourcePath("webpack://app/./src/a.tsx", "http://x/")).toBe(
        "src/a.tsx",
      );
      expect(sourcePath("webpack:///src/a.tsx", "http://x/")).toBe("src/a.tsx");
      expect(
        sourcePath("webpack-internal:///(app-pages-browser)/./src/a.tsx", ""),
      ).toBe("src/a.tsx");
      expect(sourcePath("a.tsx", "http://localhost:5173/src/a.tsx")).toBe(
        "src/a.tsx",
      );
      expect(
        sourcePath("/@fs/Users/me/lib/b.ts", "http://localhost:5173/"),
      ).toBe("/Users/me/lib/b.ts");
    });

    it("makes paths relative to the worktree", async () => {
      await expect(
        relativeToWorktree(path.join(worktree, "src/Card.vue"), worktree),
      ).resolves.toBe("src/Card.vue");
      await expect(
        relativeToWorktree("/elsewhere/a.ts", worktree),
      ).resolves.toBe("/elsewhere/a.ts");
      await expect(
        relativeToWorktree("./src/Card.vue?t=1", worktree),
      ).resolves.toBe("src/Card.vue");
      await expect(
        relativeToWorktree("src/Missing.tsx", worktree),
      ).resolves.toBe("src/Missing.tsx");
    });
  });
});
