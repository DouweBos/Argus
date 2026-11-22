import type { AgentSession } from "./models";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

const { agentMcpControl, forgetMcpControl, hasOpenMcpControl } =
  await import("./mcpControl");

function agent(authUrl: string | null, gate = Promise.resolve()): AgentSession {
  return {
    agentId: "a1",
    handle: {
      mcpControl: async () => {
        await gate;

        return { authUrl, callbackExpected: true };
      },
    },
  } as unknown as AgentSession;
}

describe("an MCP action that would die with the CLI", () => {
  afterEach(() => {
    forgetMcpControl("a1");
  });

  it("is open while it runs", async () => {
    let finish = (): void => {};
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const done = agentMcpControl(agent(null, gate), {
      action: "reconnect",
      server: "x",
    });
    expect(hasOpenMcpControl("a1")).toBe(true);

    finish();
    await done;

    expect(hasOpenMcpControl("a1")).toBe(false);
  });

  it("stays open while a sign-in is in the browser", async () => {
    await agentMcpControl(agent("https://example.com/login"), {
      action: "sign_in",
      server: "x",
    });
    expect(hasOpenMcpControl("a1")).toBe(true);
    expect(hasOpenMcpControl("a1", Date.now() + 16 * 60_000)).toBe(false);

    await agentMcpControl(agent(null), {
      action: "finish_sign_in",
      server: "x",
      callbackUrl: "https://example.com/callback",
    });

    expect(hasOpenMcpControl("a1")).toBe(false);
  });
});
