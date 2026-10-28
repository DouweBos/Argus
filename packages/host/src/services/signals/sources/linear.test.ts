/**
 * Without Argus's own Linear connection the source is a paragraph: no API
 * client, no auth, no network — its only inputs are the MCP config Argus
 * already merges into every agent. With it, Node fetches the issues itself.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../mcp/userConfig", () => ({
  listInheritedMcpServers: vi.fn(() => []),
}));

vi.mock("../../appSettings/store", () => ({
  loadAppMcpServers: vi.fn(() => ({})),
}));

vi.mock("../../integrations/service", () => ({
  linearApi: vi.fn(() => null),
}));

const { listInheritedMcpServers } = await import("../../mcp/userConfig");
const { loadAppMcpServers } = await import("../../appSettings/store");
const { linearApi } = await import("../../integrations/service");
const { LINEAR_SOURCE_ID, linearSource } = await import("./linear");
const { gatherSignals } = await import("../registry");

const mockInherited = vi.mocked(listInheritedMcpServers);
const mockAppServers = vi.mocked(loadAppMcpServers);
const mockLinearApi = vi.mocked(linearApi);

describe("linear signal source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInherited.mockReturnValue([]);
    mockAppServers.mockReturnValue({});
    mockLinearApi.mockReturnValue(null);
  });

  it("is an agent source until Linear is connected", () => {
    expect(linearSource.mode).toBe("agent");
    expect(typeof linearSource.agentInstructions).toBe("function");
  });

  it("fetches natively once Linear is connected", async () => {
    mockLinearApi.mockReturnValue({
      myIssues: vi.fn(() =>
        Promise.resolve([
          {
            id: "u1",
            identifier: "ENG-7",
            title: "Fix login",
            description: "Broken",
            url: "https://linear.app/a/issue/ENG-7",
            branchName: "eng-7-fix-login",
            state: { name: "Todo", type: "unstarted" },
            priority: 2,
            teamKey: "ENG",
            assignee: "Ann",
            labels: ["argus"],
            updatedAt: 5,
          },
        ]),
      ),
    } as unknown as ReturnType<typeof linearApi>);

    expect(linearSource.mode).toBe("native");
    await expect(linearSource.isAvailable()).resolves.toBe(true);
    const signals = await gatherSignals({
      sourceIds: [LINEAR_SOURCE_ID],
      repoRoots: [],
    });
    expect(signals.instructions).toEqual([]);
    expect(signals.items).toMatchObject([
      { external_id: "ENG-7", labels: ["argus"], source_id: LINEAR_SOURCE_ID },
    ]);
  });

  it("is unavailable when no Linear MCP server is configured", async () => {
    mockInherited.mockReturnValue([
      { name: "playwright", config: {}, source: "plugin:other" },
    ]);
    await expect(linearSource.isAvailable()).resolves.toBe(false);
  });

  it("is available when a plugin or app setting supplies one", async () => {
    mockInherited.mockReturnValue([
      { name: "linear", config: {}, source: "plugin:plex-tools" },
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
      { name: "linear", config: {}, source: "plugin:plex-tools" },
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
