import { describe, expect, it } from "vitest";
import { parseMcpStatus } from "./mcpStatus";

describe("parseMcpStatus", () => {
  it("keeps name, status, source, tool count and error, never the config", () => {
    const parsed = parseMcpStatus({
      mcpServers: [
        {
          name: "claude.ai Gmail",
          status: "connected",
          source: "claudeai",
          tools: [{ name: "a" }, { name: "b" }],
          config: { headers: { Authorization: "Bearer secret" } },
        },
        { name: "posthog", status: "failed", error: "ECONNREFUSED" },
      ],
    });

    expect(parsed).toEqual([
      {
        name: "claude.ai Gmail",
        status: "connected",
        source: "claudeai",
        toolCount: 2,
        error: null,
      },
      {
        name: "posthog",
        status: "failed",
        source: null,
        toolCount: null,
        error: "ECONNREFUSED",
      },
    ]);
  });

  it("drops malformed entries and tolerates a missing list", () => {
    expect(parseMcpStatus(undefined)).toEqual([]);
    expect(
      parseMcpStatus({ mcpServers: [null, { status: "connected" }] }),
    ).toEqual([]);
  });
});
