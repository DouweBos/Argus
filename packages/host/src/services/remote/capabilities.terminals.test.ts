/**
 * A phone reads a session's terminals — a dev server's output — but never
 * types into one, and a huddle guest sees none of it.
 */

import type { GatewayContext } from "./capabilities";
import type { PairedDevice } from "./deviceStore";
import { METHOD_SCOPE, REMOTE_METHODS } from "@argus/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));
vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    sessions: new Map(),
    terminals: new Map(),
  },
}));

const { appState } = await import("../../state");
const { dispatch } = await import("./capabilities");

function makeCtx(capabilities: PairedDevice["capabilities"]): GatewayContext {
  return {
    device: {
      device_id: "dev-1",
      label: "Phone",
      dev_static_pub: "",
      capabilities,
      created_at: 0,
      last_seen: null,
    },
    connectionId: "conn-1",
    outstandingPermissions: new Set(),
  };
}

function terminal(id: string, fields: Record<string, unknown>) {
  return {
    id,
    sessionId: "s1",
    outputLog: "",
    outputTotalBytes: 0,
    outputDroppedBytes: 0,
    unflushedChars: 0,
    exitCode: null,
    waiters: [],
    ...fields,
  };
}

describe("terminals over the gateway", () => {
  beforeEach(() => {
    appState.sessions.clear();
    appState.sessions.set("s1", { id: "s1" } as never);
    appState.terminals.clear();
    appState.terminals.set(
      "t1",
      terminal("t1", {
        runTitle: "dev",
        title: "dev",
        outputLog: "\x1b[32mready\x1b[0m on :3000\r\n",
      }) as never,
    );
    appState.terminals.set(
      "t2",
      terminal("t2", { title: "Shell 1", exitCode: 0 }) as never,
    );
  });

  it("reads at monitor and denies a scoped guest", () => {
    expect(REMOTE_METHODS["terminals.list"]).toBe("monitor");
    expect(REMOTE_METHODS["terminals.read"]).toBe("monitor");
    expect(METHOD_SCOPE["terminals.list"].kind).toBe("denied");
    expect(METHOD_SCOPE["terminals.read"].kind).toBe("denied");
    expect(REMOTE_METHODS["terminals.scrollback"]).toBe("monitor");
    expect(METHOD_SCOPE["terminals.scrollback"].kind).toBe("denied");
  });

  it("replays the broadcast output, colours and all, for a streaming reader", async () => {
    const result = await dispatch(
      "terminals.scrollback",
      { terminal_id: "t1" },
      makeCtx(["monitor"]),
    );
    expect(result).toEqual({
      data: Buffer.from("\x1b[32mready\x1b[0m on :3000\r\n").toString("base64"),
      truncated: false,
      exit_code: null,
    });
  });

  it("lists a session's live terminals", async () => {
    const result = await dispatch(
      "terminals.list",
      {
        session_id: "s1",
      },
      makeCtx(["monitor"]),
    );
    expect(result).toEqual({
      terminals: [{ id: "t1", title: "dev", run_title: "dev" }],
    });
  });

  it("returns output as plain text", async () => {
    const result = await dispatch(
      "terminals.read",
      {
        terminal_id: "t1",
      },
      makeCtx(["monitor"]),
    );
    expect(result).toEqual({
      output: "ready on :3000\r\n",
      running: true,
      exit_code: null,
      truncated: false,
    });
  });

  it("refuses a terminal that doesn't exist", async () => {
    await expect(
      dispatch("terminals.read", { terminal_id: "nope" }, makeCtx(["monitor"])),
    ).rejects.toThrow();
  });
});
