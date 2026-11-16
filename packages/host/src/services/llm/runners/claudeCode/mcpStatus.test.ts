import { describe, expect, it } from "vitest";
import {
  mcpControlPayload,
  parseMcpControlResult,
  parseMcpStatus,
} from "./mcpStatus";

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

describe("mcp control", () => {
  it("maps each action onto the CLI's control request", () => {
    expect(
      mcpControlPayload({ action: "reconnect", server: "linear" }),
    ).toEqual({ subtype: "mcp_reconnect", serverName: "linear" });
    expect(mcpControlPayload({ action: "disable", server: "linear" })).toEqual({
      subtype: "mcp_toggle",
      serverName: "linear",
      enabled: false,
    });
    expect(mcpControlPayload({ action: "sign_in", server: "linear" })).toEqual({
      subtype: "mcp_authenticate",
      serverName: "linear",
    });
    expect(
      mcpControlPayload({
        action: "finish_sign_in",
        server: "linear",
        callbackUrl: "http://localhost:1234/callback?code=x",
      }),
    ).toEqual({
      subtype: "mcp_oauth_callback_url",
      serverName: "linear",
      callbackUrl: "http://localhost:1234/callback?code=x",
    });
  });

  it("reads the sign-in page, and nothing from an empty answer", () => {
    expect(
      parseMcpControlResult({
        authUrl: "https://mcp.linear.app/authorize?x=1",
        callbackExpected: true,
        callbackPort: 1234,
      }),
    ).toEqual({
      authUrl: "https://mcp.linear.app/authorize?x=1",
      callbackExpected: true,
    });
    expect(parseMcpControlResult(undefined)).toEqual({
      authUrl: null,
      callbackExpected: false,
    });
  });
});
