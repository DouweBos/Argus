/**
 * Workspace and document symbols against the fake server: kinds mapped,
 * hierarchies flattened with their containers and without function locals,
 * locations outside the session dropped, and no server started to answer.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetHostEventSinks } from "@argus/host/bus";

vi.mock("../../state", () => ({
  appState: {
    sessions: new Map<string, { path: string }>(),
    repoRoots: new Set<string>(),
  },
}));
vi.mock("../session/git", () => ({ git: vi.fn(async () => "") }));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

const { appState } = await import("../../state");
const { capture } = await import("../telemetry/telemetry");
const servers = await import("./servers");
const manager = await import("./manager");
const documents = await import("./documents");
const watchedFiles = await import("./watchedFiles");
const symbols = await import("./symbols");

const FAKE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/fakeServer.mjs",
);
let root: string;

async function ready(): Promise<void> {
  await vi.waitFor(
    () => {
      const h = manager.allHandles().find((x) => x.sessionId === "s1");
      if (h?.state !== "ready") {
        throw new Error("not ready");
      }
    },
    { timeout: 10_000 },
  );
}

describe("language server symbols", () => {
  beforeEach(async () => {
    root = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-lsp-sym-")),
    );
    appState.sessions.set("s1", { path: root } as never);
    resetHostEventSinks();
    watchedFiles.initLanguageServers();
    vi.mocked(capture).mockClear();
    servers.setServerResolverForTest(async () => ({
      command: process.execPath,
      args: [FAKE],
      source: "bundled",
    }));
  });

  afterEach(async () => {
    watchedFiles.stopAllLanguageServers();
    servers.setServerResolverForTest(null);
    resetHostEventSinks();
    appState.sessions.clear();
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  it("answers with nothing, and starts nothing, while no server runs", async () => {
    await expect(symbols.lspWorkspaceSymbols("s1", "store")).resolves.toEqual(
      [],
    );
    await expect(symbols.lspDocumentSymbols("s1", "src/a.ts")).resolves.toEqual(
      [],
    );
    expect(manager.allHandles()).toEqual([]);
  });

  it("finds workspace symbols in the session only", async () => {
    await documents.lspDidOpen("s1", "src/a.ts", "typescript", 1, "x");
    await ready();
    await expect(symbols.lspWorkspaceSymbols("s1", "")).resolves.toEqual([]);
    await expect(symbols.lspWorkspaceSymbols("s1", "store")).resolves.toEqual([
      {
        name: "storeThing",
        kind: "class",
        container: "Module",
        relativePath: "src/a.ts",
        line: 3,
        column: 4,
      },
    ]);
    expect(capture).toHaveBeenCalledWith("lsp_feature_used", {
      feature: "workspace_symbols",
      language: "typescript",
      success: true,
    });
  });

  it("flattens an open document's symbols with containers, without locals", async () => {
    await documents.lspDidOpen("s1", "src/a.ts", "typescript", 1, "x");
    await ready();
    await expect(symbols.lspDocumentSymbols("s1", "src/a.ts")).resolves.toEqual(
      [
        {
          name: "Store",
          kind: "class",
          relativePath: "src/a.ts",
          line: 1,
          column: 6,
        },
        {
          name: "load",
          kind: "method",
          container: "Store",
          relativePath: "src/a.ts",
          line: 2,
          column: 2,
        },
        {
          name: "items",
          kind: "property",
          container: "Store",
          relativePath: "src/a.ts",
          line: 5,
          column: 2,
        },
        {
          name: "helper",
          kind: "function",
          relativePath: "src/a.ts",
          line: 7,
          column: 9,
        },
      ],
    );
  });

  it("maps flat symbol information and unknown kinds", () => {
    expect(
      symbols.flattenDocumentSymbols("a.swift", [
        {
          name: "x",
          kind: 16,
          containerName: "T",
          location: {
            uri: "file:///a.swift",
            range: {
              start: { line: 4, character: 2 },
              end: { line: 4, character: 3 },
            },
          },
        },
      ]),
    ).toEqual([
      {
        name: "x",
        kind: "other",
        container: "T",
        relativePath: "a.swift",
        line: 5,
        column: 2,
      },
    ]);
    expect(symbols.toSymbolKind(23)).toBe("struct");
    expect(symbols.toSymbolKind(22)).toBe("enum_member");
  });
});
