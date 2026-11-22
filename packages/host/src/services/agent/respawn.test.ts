import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../claudeAuth/accounts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveAccountForSession: () => "personal",
  envForAccount: () => ({ ...process.env }),
}));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));
vi.mock("./spawnStamp", () => ({ spawnConfigStamp: async () => "stamp" }));
vi.mock("../simulator/pool", () => ({
  simulatorPool: { releaseSimulator: async () => undefined },
}));
vi.mock("../browser/pool", () => ({
  webBrowserPool: { releaseBrowser: async () => undefined },
}));

const { addHostEventSink, resetHostEventSinks } =
  await import("@argus/host/bus");
const { appState } = await import("../../state");
const { respawnAgent, restoreAgentAtTurn, startAgent } =
  await import("./agentService");
const { fakeClaude } = await import("./agentService.testkit");

let fake: ReturnType<typeof fakeClaude>;
let id: string;
const events: [string, unknown][] = [];
const on = (kind: string) =>
  events.filter(([c]) => c === `agent:${kind}:${id}`).map(([, p]) => p);

async function setUp(): Promise<void> {
  fake = fakeClaude();
  id = (await startAgent("s1")).agent_id;
  events.length = 0;
  addHostEventSink((channel, args) => {
    events.push([channel, args[0]]);
  });
}

function tearDown(): void {
  resetHostEventSinks();
  appState.agents.clear();
  appState.agentPendingPermissions.clear();
  appState.sessions.clear();
}

describe("a respawn that fails", () => {
  beforeEach(setUp);
  afterEach(tearDown);

  it("doesn't look idle when the new CLI never initializes", async () => {
    fake.control.init = async () => {
      throw new Error("no handshake");
    };

    await expect(respawnAgent(id)).rejects.toMatch(/failed to initialize/);

    expect(appState.agents.get(id)!.status).toBe("error");
    expect(on("status")).toContain("error");
    expect(fake.spawns[1]!.killed).toBe(true);
  });

  it("releases whoever was waiting on it", async () => {
    const waiter = vi.fn();
    appState.agents.get(id)!.turnWaiters.push(waiter);
    fake.control.preflight = async () => {
      throw new Error("no CLI");
    };

    await expect(respawnAgent(id)).rejects.toThrow("no CLI");

    expect(waiter).toHaveBeenCalledWith("error");
  });

  it("doesn't look busy when a rewind's respawn fails", async () => {
    fake.control.preflight = async () => {
      throw new Error("no CLI");
    };

    await expect(
      restoreAgentAtTurn({
        agentId: id,
        sourceClaudeSessionId: null,
        keepTurnNumber: 0,
        cutoffTimestampMs: 0,
        seed: "",
      }),
    ).rejects.toThrow("no CLI");

    expect(appState.agents.get(id)!.status).toBe("error");
    expect(on("status")).toContain("error");
  });
});
