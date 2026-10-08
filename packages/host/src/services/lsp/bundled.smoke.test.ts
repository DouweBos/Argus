/**
 * The real bundled servers, end to end: a broken file in a worktree with no
 * TypeScript of its own gets a diagnostic from the bundled tsserver, and the
 * JSON/YAML/CSS/HTML servers come up. Skipped where they can't run (not
 * installed, Node too old). With `ARGUS_RESOURCES` pointed at a staged Mac
 * host's resources it checks the packaged layout instead.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addHostEventSink, resetHostEventSinks } from "@argus/host/bus";

vi.mock("../../state", () => ({
  appState: {
    sessions: new Map<string, { path: string }>(),
    repoRoots: new Set<string>(),
  },
}));
vi.mock("../session/git", () => ({ git: vi.fn(async () => "") }));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

const { appState } = await import("../../state");
const { bundledPath } = await import("../code/bundled");
const { bundledTsserverPath } = await import("./servers");
const manager = await import("./manager");
const documents = await import("./documents");
const features = await import("./features");

const [major, minor] = process.versions.node.split(".").map(Number);
const runnable =
  (major > 22 || (major === 22 && minor >= 22)) &&
  fs.existsSync(bundledPath("", "typescript-language-server/lib/cli.mjs")) &&
  fs.existsSync(bundledTsserverPath());

let root: string;
const diagnostics: { relativePath: string; diagnostics: unknown[] }[] = [];

describe.skipIf(!runnable)("bundled language servers", () => {
  beforeAll(async () => {
    root = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-ts-smoke-")),
    );
    await fs.promises.writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
    );
    appState.sessions.set("smoke", { path: root } as never);
    resetHostEventSinks();
    addHostEventSink((channel, args) => {
      if (channel === "lsp:diagnostics:smoke") {
        diagnostics.push(args[0] as (typeof diagnostics)[number]);
      }
    });
  });

  afterAll(async () => {
    manager.stopLanguageServers();
    resetHostEventSinks();
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  it("reports a type error and answers hover", async () => {
    const text = "const n: number = 'not a number';\nexport { n };\n";
    await fs.promises.writeFile(path.join(root, "broken.ts"), text);
    await documents.lspDidOpen("smoke", "broken.ts", "typescript", 1, text);
    await vi.waitFor(
      () =>
        expect(
          diagnostics.some(
            (d) => d.relativePath === "broken.ts" && d.diagnostics.length > 0,
          ),
        ).toBe(true),
      { timeout: 45_000, interval: 200 },
    );
    expect(manager.lspStatus("smoke").servers).toEqual([
      { language: "typescript", state: "ready", source: "bundled" },
    ]);
    const hover = await features.lspHover("smoke", "broken.ts", {
      line: 0,
      character: 6,
    });
    expect(hover?.contents).toContain("number");
  }, 60_000);

  it.each([
    ["broken.json", "json", '{"a": }'],
    ["broken.yaml", "yaml", "a: [1,\n"],
    ["broken.css", "css", "a { color: ; }"],
  ])(
    "gets a diagnostic for %s from the bundled server",
    async (file, id, text) => {
      await documents.lspDidOpen("smoke", file, id, 1, text);
      await vi.waitFor(
        () =>
          expect(
            diagnostics.some(
              (d) => d.relativePath === file && d.diagnostics.length > 0,
            ),
          ).toBe(true),
        { timeout: 20_000, interval: 100 },
      );
    },
    30_000,
  );

  it("starts the bundled HTML server", async () => {
    await documents.lspDidOpen("smoke", "page.html", "html", 1, "<div></div>");
    await vi.waitFor(
      () =>
        expect(manager.lspStatus("smoke").servers).toContainEqual({
          language: "html",
          state: "ready",
          source: "bundled",
        }),
      { timeout: 20_000, interval: 100 },
    );
  }, 30_000);
});
