/**
 * The language-server lifecycle against a fake stdio server: lazy start,
 * refcounted documents across connections, idle shutdown, the live-server cap,
 * crash backoff and give-up, session deletion, and URI rewriting.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addHostEventSink,
  emitHostEvent,
  resetHostEventSinks,
} from "@argus/host/bus";

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
const { closeConnection, runInConnection } =
  await import("../remote/connectionScope");
const { writeCodeFile } = await import("../code/files");
const servers = await import("./servers");
const manager = await import("./manager");
const documents = await import("./documents");
const features = await import("./features");
const watchedFiles = await import("./watchedFiles");

const FAKE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/fakeServer.mjs",
);

let roots: string[];
let events: { channel: string; payload: unknown }[];
let flags: string[];

async function session(id: string): Promise<string> {
  const root = await fs.promises.realpath(
    await fs.promises.mkdtemp(path.join(os.tmpdir(), `argus-lsp-${id}-`)),
  );
  roots.push(root);
  appState.sessions.set(id, { path: root } as never);

  return root;
}

function handle(sessionId: string, language = "typescript") {
  const found = manager
    .allHandles()
    .find((h) => h.sessionId === sessionId && h.language === language);
  if (!found) {
    throw new Error(`no ${language} handle for ${sessionId}`);
  }

  return found;
}

async function ready(sessionId: string, language = "typescript") {
  return vi.waitFor(
    () => {
      const h = handle(sessionId, language);
      if (h.state !== "ready" || !h.proc) {
        throw new Error(`state ${h.state}`);
      }

      return h.proc;
    },
    { timeout: 10_000 },
  );
}

interface FakeState {
  pid: number;
  docs: Record<string, { text: string; version: number }>;
  watched: { uri: string; type: number }[];
  configuration: unknown;
}

async function fakeState(sessionId: string): Promise<FakeState> {
  return (await ready(sessionId)).request<FakeState>(
    { method: "fake/state" },
    {},
  );
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

const open = (id: string, rel: string, text: string) =>
  documents.lspDidOpen(id, rel, "typescript", 1, text);

describe("language server manager", () => {
  beforeEach(() => {
    roots = [];
    events = [];
    flags = [];
    appState.sessions.clear();
    resetHostEventSinks();
    addHostEventSink((channel, args) =>
      events.push({ channel, payload: args[0] }),
    );
    watchedFiles.initLanguageServers();
    manager.LSP_TIMING.restartBaseMs = 20;
    manager.LSP_TIMING.idleShutdownMs = 10 * 60_000;
    vi.mocked(capture).mockClear();
    servers.setServerResolverForTest(async () => ({
      command: process.execPath,
      args: [FAKE, ...flags],
      source: "bundled",
    }));
  });

  afterEach(async () => {
    watchedFiles.stopAllLanguageServers();
    servers.setServerResolverForTest(null);
    resetHostEventSinks();
    for (const root of roots) {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it("starts on the first open document and publishes session-relative diagnostics", async () => {
    await session("s1");
    await open("s1", "src/a.ts", "ok\nan ERROR here\n");
    await ready("s1");
    await vi.waitFor(() =>
      expect(events).toContainEqual({
        channel: "lsp:diagnostics:s1",
        payload: {
          relativePath: "src/a.ts",
          version: 1,
          diagnostics: [
            {
              range: {
                start: { line: 1, character: 3 },
                end: { line: 1, character: 8 },
              },
              severity: "error",
              message: "bad",
              source: "fake",
              code: "42",
            },
          ],
        },
      }),
    );
    const states = events
      .filter((e) => e.channel === "lsp:status:s1")
      .map(
        (e) => (e.payload as { servers: { state: string }[] }).servers[0].state,
      );
    expect(states).toEqual(["starting", "ready"]);
    expect(manager.lspStatus("s1")).toEqual({
      servers: [{ language: "typescript", state: "ready", source: "bundled" }],
    });
    expect(capture).toHaveBeenCalledWith(
      "lsp_server_started",
      expect.objectContaining({ language: "typescript", success: true }),
    );
  });

  it.each(["incremental", "full"])(
    "keeps the server's text in step with %s changes",
    async (sync) => {
      flags = [`--sync=${sync}`];
      const root = await session("s1");
      await open("s1", "a.ts", "hello world\nsecond");
      await ready("s1");
      await documents.lspDidChange("s1", "a.ts", 2, [
        {
          range: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 11 },
          },
          text: "there",
        },
        {
          range: {
            start: { line: 1, character: 6 },
            end: { line: 1, character: 6 },
          },
          text: "!",
        },
      ]);
      const state = await fakeState("s1");
      expect(Object.values(state.docs)).toEqual([
        { text: "hello there\nsecond!", version: 2 },
      ]);
      expect(Object.keys(state.docs)[0]).toBe(
        `file://${path.join(root, "a.ts")}`,
      );
    },
  );

  it("counts holders across connections and closes with the last", async () => {
    await session("s1");
    await runInConnection("c1", () => open("s1", "a.ts", "x"));
    await runInConnection("c2", () => open("s1", "a.ts", "x"));
    await ready("s1");
    closeConnection("c1");
    expect(Object.keys((await fakeState("s1")).docs)).toHaveLength(1);
    closeConnection("c2");
    await vi.waitFor(async () =>
      expect((await fakeState("s1")).docs).toEqual({}),
    );
    expect(handle("s1").docs.size).toBe(0);
  });

  it("shuts an idle server down and starts it again on the next open", async () => {
    manager.LSP_TIMING.idleShutdownMs = 50;
    await session("s1");
    await open("s1", "a.ts", "x");
    const { pid } = await fakeState("s1");
    await documents.lspDidClose("s1", "a.ts");
    await vi.waitFor(() => expect(handle("s1").state).toBe("stopped"));
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5000 });
    await open("s1", "a.ts", "x");
    expect((await fakeState("s1")).pid).not.toBe(pid);
  });

  it("never runs more than six servers, evicting the least recently used", async () => {
    for (let i = 0; i < 7; i++) {
      await session(`s${i}`);
      await open(`s${i}`, "a.ts", "x");
      await ready(`s${i}`);
    }
    const live = manager.allHandles().filter((h) => h.proc);
    expect(live).toHaveLength(manager.MAX_LIVE_SERVERS);
    expect(handle("s0").state).toBe("stopped");
    expect(handle("s0").docs.size).toBe(1);
    // Using it again brings it back, at someone else's expense.
    await features.lspHover("s0", "a.ts", { line: 0, character: 0 });
    expect(handle("s0").state).toBe("ready");
    expect(handle("s1").state).toBe("stopped");
  });

  it("restarts a crashed server and replays its documents", async () => {
    await session("s1");
    await open("s1", "a.ts", "keep me");
    const first = await fakeState("s1");
    (await ready("s1")).notify({ method: "fake/crash" }, {});
    await vi.waitFor(async () =>
      expect((await fakeState("s1")).pid).not.toBe(first.pid),
    );
    expect(Object.values((await fakeState("s1")).docs)).toEqual([
      { text: "keep me", version: 1 },
    ]);
    expect(capture).toHaveBeenCalledWith("lsp_server_crashed", {
      language: "typescript",
      gave_up: false,
    });
  });

  it("gives up after three restarts in five minutes until told to retry", async () => {
    flags = ["--crash-on-init"];
    await session("s1");
    await open("s1", "a.ts", "x");
    await vi.waitFor(() => expect(handle("s1").state).toBe("failed"), {
      timeout: 10_000,
    });
    expect(capture).toHaveBeenCalledWith("lsp_server_crashed", {
      language: "typescript",
      gave_up: true,
    });
    expect(
      vi
        .mocked(capture)
        .mock.calls.filter((c) => c[0] === "lsp_server_crashed"),
    ).toHaveLength(manager.MAX_RESTARTS + 1);
    flags = [];
    manager.lspRestart("s1", "typescript");
    await ready("s1");
  });

  it("reports a missing server and doesn't retry it on its own", async () => {
    servers.setServerResolverForTest(async () => ({
      missing: "Not found: gopls",
    }));
    await session("s1");
    await documents.lspDidOpen("s1", "main.go", "go", 1, "package main");
    await vi.waitFor(() =>
      expect(manager.lspStatus("s1").servers).toEqual([
        { language: "go", state: "missing", message: "Not found: gopls" },
      ]),
    );
    await expect(
      features.lspHover("s1", "main.go", { line: 0, character: 0 }),
    ).resolves.toBeNull();
  });

  it("kills a deleted session's servers", async () => {
    await session("s1");
    await open("s1", "a.ts", "x");
    const { pid } = await fakeState("s1");
    emitHostEvent("session:deleted", "s1");
    expect(manager.allHandles()).toEqual([]);
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5000 });
  });

  it("rewrites URIs to session paths and drops locations outside every root", async () => {
    await session("s1");
    await open("s1", "src/a.ts", "x");
    await ready("s1");
    await expect(
      features.lspDefinition("s1", "src/a.ts", { line: 0, character: 0 }),
    ).resolves.toEqual([
      {
        relativePath: "src/a.ts",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
      },
    ]);
  });

  it("answers hover, completion with resolve, and code actions as edits", async () => {
    await session("s1");
    await open("s1", "a.ts", "ERROR");
    await ready("s1");
    await expect(
      features.lspHover("s1", "a.ts", { line: 0, character: 0 }),
    ).resolves.toEqual({ contents: "**5**" });
    const list = await features.lspCompletion("s1", "a.ts", {
      line: 0,
      character: 1,
    });
    expect(list.items).toEqual([
      { resolveId: expect.any(String), label: "alpha", kind: "function" },
    ]);
    await expect(
      features.lspCompletionResolve("s1", "a.ts", list.items[0].resolveId),
    ).resolves.toMatchObject({ documentation: "docs for alpha" });
    // Wait for the diagnostic so the quick fix is asked about it.
    await vi.waitFor(() => expect(handle("s1").diagnostics.size).toBe(1));
    const actions = await features.lspCodeActions("s1", "a.ts", {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 5 },
    });
    expect(actions).toEqual([
      { actionId: expect.any(String), title: "Fix 1", kind: "quickfix" },
    ]);
    await expect(
      features.lspExecuteCodeAction("s1", "a.ts", actions[0].actionId),
    ).resolves.toEqual({
      files: [
        {
          relativePath: "a.ts",
          edits: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
              newText: "// fixed\n",
            },
          ],
        },
      ],
    });
    expect(capture).toHaveBeenCalledWith("lsp_feature_used", {
      feature: "code_action",
      language: "typescript",
      success: true,
    });
  });

  it("tells servers about files saved that aren't open", async () => {
    const root = await session("s1");
    await open("s1", "a.ts", "x");
    await ready("s1");
    await writeCodeFile("s1", "b.ts", "other", null);
    await vi.waitFor(async () =>
      expect((await fakeState("s1")).watched).toEqual([
        { uri: `file://${path.join(root, "b.ts")}`, type: 2 },
      ]),
    );
  });

  it("answers workspace/configuration from the server's settings", async () => {
    await session("s1");
    await open("s1", "a.ts", "x");
    await vi.waitFor(async () =>
      expect((await fakeState("s1")).configuration).toEqual([null]),
    );
  });
});
