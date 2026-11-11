import { describe, expect, it } from "vitest";
import { toAcpMcpServers } from "./mcp";

const servers = {
  argus: {
    type: "http",
    url: "http://127.0.0.1:1234/mcp",
    headers: { Authorization: "Bearer t" },
  },
  local: { command: "tool", args: ["--x"] },
};
const bridge = { command: "/node", args: ["/host/argus-mcp-stdio.js"] };

describe("toAcpMcpServers", () => {
  it("passes HTTP servers through to agents that support them", () => {
    const out = toAcpMcpServers(servers, true, bridge);

    expect(out.skipped).toEqual([]);
    expect(out.servers[0]).toEqual({
      type: "http",
      name: "argus",
      url: "http://127.0.0.1:1234/mcp",
      headers: [{ name: "Authorization", value: "Bearer t" }],
    });
  });

  it("bridges HTTP servers over stdio for agents that don't", () => {
    const out = toAcpMcpServers(servers, false, bridge);

    expect(out.skipped).toEqual([]);
    expect(out.bridged).toEqual(["argus"]);
    expect(out.servers).toEqual([
      {
        name: "argus",
        command: "/node",
        args: ["/host/argus-mcp-stdio.js"],
        env: [
          { name: "ARGUS_MCP_BRIDGE_URL", value: "http://127.0.0.1:1234/mcp" },
          {
            name: "ARGUS_MCP_BRIDGE_HEADERS",
            value: '{"Authorization":"Bearer t"}',
          },
        ],
      },
      { name: "local", command: "tool", args: ["--x"], env: [] },
    ]);
  });

  it("skips HTTP servers when there is no bridge", () => {
    expect(toAcpMcpServers(servers, false).skipped).toEqual(["argus"]);
  });
});
