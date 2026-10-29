import type { LlmRunner, LlmRunnerHandle } from "../llm/runners/types";
import type { Session } from "../session/models";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

vi.mock("./spawnStamp", () => ({ spawnConfigStamp: async () => "stamp" }));
vi.mock("../claudeAuth/accounts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveAccountForSession: () => "personal",
  envForAccount: () => ({ ...process.env }),
}));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

const { appState } = await import("../../state");
const { registerRunner } = await import("../llm/registry");
const { listAgents, startAgent, spawnSpare } = await import("./agentService");
const { clearSpares, fillSpare, hasSpare } = await import("./spares");

type FakeHandle = LlmRunnerHandle & {
  setModel: Mock<(model: string) => Promise<void>>;
  setPermissionMode: Mock<(mode: string) => Promise<void>>;
  kill: Mock<() => Promise<void>>;
};

const spawned: { agentId: string; handle: FakeHandle }[] = [];

function fakeHandle(runnerId: string): FakeHandle {
  return {
    runnerId,
    on: () => {},
    send: vi.fn(),
    interrupt: vi.fn(),
    setModel: vi.fn(async () => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    setEffort: vi.fn(),
    respondToPermission: vi.fn(),
    kill: vi.fn(async () => undefined),
    initializeResponse: () => ({ commands: [], models: [] }) as never,
    waitForInit: async () => undefined,
    cleanup: vi.fn(),
  } as unknown as FakeHandle;
}

function fakeRunner(id: string): LlmRunner {
  return {
    id,
    displayName: id,
    isCustom: id !== "claude-code",
    capabilities: () => ({
      supportsMcp: false,
      supportsTranscriptFork: true,
      supportsSetModel: true,
      supportsSetPermissionMode: true,
      supportsSetEffort: true,
      supportsInterrupt: true,
    }),
    defaultModel: () => null,
    preflight: async () => ({ ok: true, binPath: "/usr/bin/fake" }),
    spawn: async ({ agentId }) => {
      const handle = fakeHandle(id);
      spawned.push({ agentId, handle });

      return handle;
    },
    oneShot: async () => null,
  };
}

async function warm(): Promise<string> {
  await fillSpare("s1", () => spawnSpare("s1"));
  const spareId = spawned.at(-1)!.agentId;
  spawned.length = 0;

  return spareId;
}

describe("starting an agent in a session with a warm spare", () => {
  beforeEach(() => {
    registerRunner(fakeRunner("claude-code"));
    registerRunner(fakeRunner("custom:apex"));
    const dir = mkdtempSync(path.join(os.tmpdir(), "argus-warm-"));
    appState.sessions.set("s1", {
      id: "s1",
      path: dir,
      repo_root: dir,
      kind: "worktree",
      runner_id: "claude-code",
    } as unknown as Session);
  });

  afterEach(() => {
    clearSpares();
    appState.agents.clear();
    appState.sessions.clear();
    spawned.length = 0;
  });

  it("takes the spare instead of spawning, under the spare's own id", async () => {
    const spareId = await warm();

    const info = await startAgent(
      "s1",
      "claude-opus-5-5",
      "plan",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "client-minted",
    );

    expect(spawned).toHaveLength(0);
    expect(info.agent_id).toBe(spareId);
    expect(hasSpare("s1")).toBe(false);
    const agent = appState.agents.get(spareId)!;
    expect(agent.model).toBe("claude-opus-5-5");
    expect(agent.permissionMode).toBe("plan");
    expect(agent.handle.setModel).toHaveBeenCalledWith("claude-opus-5-5");
  });

  it("isn't listed while it waits", async () => {
    await warm();

    expect(appState.agents.size).toBe(0);
    expect(listAgents("s1")).toEqual([]);
  });

  it.each([
    ["trusted", ["s1", undefined, "trusted"]],
    ["a resume", ["s1", undefined, undefined, "claude-session"]],
    ["an extra system prompt", ["s1", undefined, undefined, undefined, "more"]],
    ["platforms", ["s1", undefined, undefined, undefined, undefined, ["ios"]]],
    [
      "another runner",
      [
        "s1",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "custom:apex",
      ],
    ],
    [
      "a fork",
      [
        "s1",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
      ],
    ],
  ] as const)("spawns fresh for %s", async (_label, args) => {
    const spareId = await warm();

    const info = await startAgent(
      ...(args as unknown as Parameters<typeof startAgent>),
    );

    expect(spawned).toHaveLength(1);
    expect(info.agent_id).not.toBe(spareId);
  });

  it("spawns fresh when the spare refuses the requested mode", async () => {
    const spareId = await warm();
    const spareHandle = (await import("./spares")).getSpare("s1")!.agent
      .handle as FakeHandle;
    spareHandle.setPermissionMode.mockRejectedValueOnce("nope");

    const info = await startAgent("s1", undefined, "ask");

    expect(info.agent_id).not.toBe(spareId);
    expect(spareHandle.kill).toHaveBeenCalled();
    expect(appState.agents.has(spareId)).toBe(false);
  });
});
