import type { LlmRunner, LlmRunnerSpawnArgs } from "../llm/runners/types";
import type { Session } from "../session/models";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./spawnStamp", () => ({ spawnConfigStamp: async () => "stamp" }));
vi.mock("../claudeAuth/accounts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveAccountForSession: () => "personal",
  envForAccount: () => ({ ...process.env }),
}));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));
vi.mock("../mcp/server", () => ({
  getMcpPort: () => 4242,
  getMcpAuthToken: () => "token",
}));
vi.mock("../mcp/userConfig", () => ({
  buildMergedMcpServers: async (_cwd: string, own: object) => own,
}));
const closeMcpSessionsForSpawn = vi.hoisted(() => vi.fn());
vi.mock("../mcp/sessions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  closeMcpSessionsForSpawn,
}));

const { appState } = await import("../../state");
const { registerRunner } = await import("../llm/registry");
const { spawnSpare } = await import("./agentService");
const { killSpare } = await import("./spares");
const { SPAWN_ID_HEADER } = await import("../mcp/sessions");

const spawns: { args: LlmRunnerSpawnArgs; handle: EventEmitter }[] = [];

function fakeRunner(): LlmRunner {
  return {
    id: "claude-code",
    displayName: "fake",
    isCustom: false,
    capabilities: () => ({
      supportsMcp: true,
      supportsTranscriptFork: false,
      supportsSetModel: true,
      supportsSetPermissionMode: true,
      supportsSetEffort: true,
      supportsInterrupt: true,
      supportsSideQuestion: true,
    }),
    defaultModel: () => null,
    preflight: async () => ({ ok: true, binPath: "/usr/bin/fake" }),
    spawn: async (args) => {
      const handle = Object.assign(new EventEmitter(), {
        runnerId: "claude-code",
        waitForInit: async () => undefined,
        initializeResponse: () => null,
        kill: async () => {
          handle.emit("exit", 143);
        },
        cleanup: () => undefined,
      });
      spawns.push({ args, handle });

      return handle as never;
    },
    oneShot: async () => null,
  };
}

function spawnIdOf(args: LlmRunnerSpawnArgs): string {
  const argus = args.mcpServers.argus as { headers: Record<string, string> };

  return argus.headers[SPAWN_ID_HEADER]!;
}

describe("a CLI's MCP sessions", () => {
  afterEach(() => {
    appState.sessions.clear();
    spawns.length = 0;
  });

  it("are released when a discarded spare's process exits", async () => {
    registerRunner(fakeRunner());
    const dir = mkdtempSync(path.join(os.tmpdir(), "argus-mcp-release-"));
    appState.sessions.set("s1", {
      id: "s1",
      path: dir,
      repo_root: dir,
      kind: "worktree",
      runner_id: "claude-code",
    } as unknown as Session);

    const first = await spawnSpare("s1");
    const second = await spawnSpare("s1");
    const [a, b] = spawns.map((s) => spawnIdOf(s.args));
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);

    killSpare(first.agent);
    await vi.waitFor(() =>
      expect(closeMcpSessionsForSpawn).toHaveBeenCalledWith(a),
    );
    expect(closeMcpSessionsForSpawn).not.toHaveBeenCalledWith(b);
    killSpare(second.agent);
  });
});
