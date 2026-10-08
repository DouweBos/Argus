/**
 * Swift documents against a fake server: one server per package root, and
 * none at all where sourcekit-lsp would report false errors.
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

const FAKE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/fakeServer.mjs",
);

let root: string;
const resolver = vi.fn(async () => ({
  command: process.execPath,
  args: [FAKE],
  source: "toolchain" as const,
}));

function write(rel: string, text = ""): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const open = (rel: string) =>
  documents.lspDidOpen("s", rel, "swift", 1, "let x = 1\n");

const status = () => manager.lspStatus("s").servers;

describe("swift routing", () => {
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "swift-rt-")));
    appState.sessions.set("s", { path: root } as never);
    resetHostEventSinks();
    resolver.mockClear();
    vi.mocked(capture).mockClear();
    servers.setServerResolverForTest(resolver);
  });

  afterEach(() => {
    manager.stopLanguageServers();
    servers.setServerResolverForTest(null);
    appState.sessions.clear();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("runs one server per package, rooted at it", async () => {
    write("A/Package.swift");
    write("B/Package.swift");
    await open("A/Sources/A/a.swift");
    await open("B/Sources/B/b.swift");
    await vi.waitFor(() =>
      expect(status()).toEqual([
        { language: "swift", state: "ready", source: "toolchain", root: "A" },
        { language: "swift", state: "ready", source: "toolchain", root: "B" },
      ]),
    );
    expect(
      manager
        .allHandles()
        .filter((h) => h.proc)
        .map((h) => h.root)
        .sort(),
    ).toEqual([path.join(root, "A"), path.join(root, "B")]);
    expect(capture).toHaveBeenCalledWith(
      "lsp_server_started",
      expect.objectContaining({ project: "swiftpm", success: true }),
    );
  });

  it("holds back an Xcode project's files without starting anything", async () => {
    fs.mkdirSync(path.join(root, "App.xcodeproj"));
    await open("App/AppDelegate.swift");
    await vi.waitFor(() =>
      expect(status()).toEqual([
        expect.objectContaining({ language: "swift", state: "needs_setup" }),
      ]),
    );
    expect(status()[0].message).toMatch(/build server/);
    expect(resolver).not.toHaveBeenCalled();
    expect(manager.allHandles().every((h) => !h.proc)).toBe(true);
    expect(capture).toHaveBeenCalledWith("lsp_setup_needed", {
      language: "swift",
      reason: expect.any(String),
    });
  });

  it("runs a lone file in single-file mode but not a group of loose files", async () => {
    write("tool.swift");
    write("scripts/a.swift");
    write("scripts/b.swift");
    await open("tool.swift");
    await open("scripts/a.swift");
    await vi.waitFor(() =>
      expect(status()).toEqual([
        { language: "swift", state: "ready", source: "toolchain" },
        expect.objectContaining({
          state: "needs_setup",
          root: "scripts",
        }),
      ]),
    );
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("routes files again on restart", async () => {
    write("Sources/a.swift");
    write("Sources/b.swift");
    await open("Sources/a.swift");
    await vi.waitFor(() => expect(status()[0].state).toBe("needs_setup"));
    write("Package.swift");
    documents.restartLanguage("s", "swift");
    await vi.waitFor(() =>
      expect(status()).toEqual([
        { language: "swift", state: "ready", source: "toolchain" },
      ]),
    );
  });
});
