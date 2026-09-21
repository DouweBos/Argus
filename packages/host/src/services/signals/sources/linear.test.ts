/**
 * The point of an agent-mode source is that it is a paragraph: no API client,
 * no auth, no network. These tests hold that line — the source's only inputs
 * are the MCP config Argus already merges into every agent.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../mcp/userConfig", () => ({
  listInheritedMcpServers: vi.fn(() => []),
}));

vi.mock("../../appSettings/store", () => ({
  loadAppMcpServers: vi.fn(() => ({})),
}));

const { listInheritedMcpServers } = await import("../../mcp/userConfig");
const { loadAppMcpServers } = await import("../../appSettings/store");
const { LINEAR_SOURCE_ID, linearSource } = await import("./linear");
const { gatherSignals } = await import("../registry");

const mockInherited = vi.mocked(listInheritedMcpServers);
const mockAppServers = vi.mocked(loadAppMcpServers);

describe("linear signal source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInherited.mockReturnValue([]);
    mockAppServers.mockReturnValue({});
  });

  it("is an agent source with no fetcher of its own", () => {
    expect(linearSource.mode).toBe("agent");
    expect(linearSource.fetchAssigned).toBeUndefined();
    expect(typeof linearSource.agentInstructions).toBe("function");
  });

  it("is unavailable when no Linear MCP server is configured", async () => {
    mockInherited.mockReturnValue([
      { name: "playwright", config: {}, source: "plugin:other" },
    ]);
    await expect(linearSource.isAvailable()).resolves.toBe(false);
  });

  it("is available when a plugin or app setting supplies one", async () => {
    mockInherited.mockReturnValue([
      { name: "linear", config: {}, source: "plugin:team-tools" },
    ]);
    await expect(linearSource.isAvailable()).resolves.toBe(true);

    mockInherited.mockReturnValue([]);
    mockAppServers.mockReturnValue({ "Linear-Server": {} });
    await expect(linearSource.isAvailable()).resolves.toBe(true);
  });

  it("contributes instructions naming the MCP tools and the WorkItem shape", () => {
    const text = linearSource.agentInstructions?.() ?? "";
    expect(text).toContain("list_my_issues");
    expect(text).toContain("external_id");
    expect(text).toContain(LINEAR_SOURCE_ID);
    expect(text).not.toContain("api.linear.app");
  });

  it("gathers as instructions, never as items", async () => {
    mockInherited.mockReturnValue([
      { name: "linear", config: {}, source: "plugin:team-tools" },
    ]);

    const signals = await gatherSignals({
      sourceIds: [LINEAR_SOURCE_ID],
      repoRoots: [],
    });

    expect(signals.items).toEqual([]);
    expect(signals.unavailable).toEqual([]);
    expect(signals.instructions).toHaveLength(1);
    expect(signals.instructions[0]).toContain("Linear");
  });

  it("drops out of the run when it is not configured, without failing it", async () => {
    const signals = await gatherSignals({
      sourceIds: [LINEAR_SOURCE_ID],
      repoRoots: [],
    });

    expect(signals.instructions).toEqual([]);
    expect(signals.unavailable).toEqual([LINEAR_SOURCE_ID]);
  });
});
