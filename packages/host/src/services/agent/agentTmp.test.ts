import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => `argus-tmp-test-${process.pid}-${Date.now()}`);
vi.mock("../../lib/argusHome", () => ({ argusHomeDir: () => home }));
vi.mock("@argus/host/bus", () => ({ emitHostEvent: () => {} }));

const { appState } = await import("../../state");
const { agentTmpDir, agentTmpRoot, ensureAgentTmpDir, sweepAgentTmpDirs } =
  await import("./agentTmp");
const { forgetAgent } = await import("./forget");

const settle = () => new Promise((r) => setTimeout(r, 50));

describe("agent temp dirs", () => {
  afterAll(() => rmSync(agentTmpRoot(), { recursive: true, force: true }));

  it("removes an agent's dir when the agent is forgotten", async () => {
    const dir = ensureAgentTmpDir("agent-a");
    writeFileSync(path.join(dir, "scratch.txt"), "x");

    forgetAgent("agent-a");
    await settle();

    expect(existsSync(dir)).toBe(false);
  });

  it("sweeps dirs no live agent owns", async () => {
    const orphan = ensureAgentTmpDir("agent-orphan");
    const live = ensureAgentTmpDir("agent-live");
    appState.agents.set("agent-live", {} as never);

    await sweepAgentTmpDirs();

    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(live)).toBe(true);
    appState.agents.delete("agent-live");
  });

  it("refuses an id that could escape the root", () => {
    expect(() => agentTmpDir("../etc")).toThrow();
  });
});
