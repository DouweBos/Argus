/**
 * Several hosts attached at once. What matters is that nothing leaks between
 * them: a call goes to the machine that owns its subject, an event is only
 * delivered as coming from the host that sent it, and a host going down leaves
 * the others working.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeHost {
  emit: (event: string, payload: unknown) => void;
  invoked: { args: unknown; channel: string }[];
  setState: (state: string) => void;
}

const fakes = new Map<string, FakeHost>();

vi.mock("./remote", () => ({
  RemoteTransport: class {
    private readonly listeners = new Map<
      string,
      Set<(payload: unknown) => void>
    >();
    private state = "connecting";
    readonly invoked: { args: unknown; channel: string }[] = [];

    constructor(
      private readonly paired: { id: string; label: string },
      private readonly handlers: { onState: (state: string) => void },
    ) {
      fakes.set(paired.id, {
        invoked: this.invoked,
        emit: (event, payload) => {
          for (const handler of this.listeners.get(event) ?? []) {
            handler(payload);
          }
        },
        setState: (state) => {
          this.state = state;
          this.handlers.onState(state);
        },
      });
    }

    connect() {}
    disconnect() {}

    invoke(channel: string, args?: Record<string, unknown>) {
      this.invoked.push({ channel, args });
      if (this.state === "offline") {
        return Promise.reject(new Error(`${this.paired.label} is offline`));
      }

      return Promise.resolve(this.paired.id);
    }

    send() {}

    on(event: string, callback: (payload: unknown) => void) {
      let set = this.listeners.get(event);
      if (!set) {
        set = new Set();
        this.listeners.set(event, set);
      }
      set.add(callback);

      return () => set.delete(callback);
    }
  },
}));

const localInvoke = vi.fn().mockResolvedValue("local");
const localOn = vi.fn();
vi.stubGlobal("window", {
  argus: { invoke: localInvoke, send: vi.fn(), on: localOn },
});
vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
});

const { attachHost, detachHost, resetRegistry, subscribe } =
  await import("./registry");
const { getTransportForCommand } = await import("./index");
const { LOCAL_HOST_ID } = await import("./hostId");
const { rememberSessionHost, resetHostIndex } = await import("./hostIndex");
const { resetConnections, getHostConnection } =
  await import("../../stores/connectionStore");

function host(id: string) {
  return {
    id,
    label: id,
    url: `ws://${id}`,
    devPrivB64: "",
    devPubB64: "",
    hostPubB64: "",
    capabilities: ["admin"],
    pairedAt: 0,
  };
}

/** `attachHost` resolves on `ready`; the fake never connects by itself. */
async function attach(id: string): Promise<void> {
  const pending = attachHost(host(id), { timeoutMs: 1000 });
  await vi.waitFor(() => expect(fakes.has(id)).toBe(true));
  fakes.get(id)?.setState("ready");
  await pending;
}

describe("connection registry", () => {
  beforeEach(() => {
    resetRegistry();
    resetConnections();
    resetHostIndex();
    fakes.clear();
    localInvoke.mockClear();
    localOn.mockClear();
  });

  it("routes a call to the host that owns its session", async () => {
    await attach("mini");
    await attach("droid");
    rememberSessionHost("s-ios", "mini");
    rememberSessionHost("s-android", "droid");

    await getTransportForCommand("start_agent", {
      sessionId: "s-ios",
    }).invoke("start_agent", { sessionId: "s-ios" });
    await getTransportForCommand("start_agent", {
      sessionId: "s-android",
    }).invoke("start_agent", { sessionId: "s-android" });

    expect(fakes.get("mini")?.invoked).toHaveLength(1);
    expect(fakes.get("droid")?.invoked).toHaveLength(1);
    expect(fakes.get("mini")?.invoked[0].args).toEqual({ sessionId: "s-ios" });
  });

  it("keeps a call about a local session on this Mac", async () => {
    await attach("mini");
    rememberSessionHost("s-here", LOCAL_HOST_ID);

    await getTransportForCommand("list_sessions", {
      sessionId: "s-here",
    }).invoke("list_sessions", { sessionId: "s-here" });

    expect(localInvoke).toHaveBeenCalledTimes(1);
    expect(fakes.get("mini")?.invoked).toHaveLength(0);
  });

  it("tells subscribers which host an event came from", async () => {
    await attach("mini");
    await attach("droid");
    const seen: { hostId: string; payload: unknown }[] = [];
    subscribe("agent:status:a1", (payload, hostId) =>
      seen.push({ payload, hostId }),
    );

    fakes.get("mini")?.emit("agent:status:a1", "running");
    fakes.get("droid")?.emit("agent:status:a1", "idle");

    expect(seen).toEqual([
      { hostId: "mini", payload: "running" },
      { hostId: "droid", payload: "idle" },
    ]);
  });

  it("delivers nothing from a host a listener did not ask for", async () => {
    await attach("mini");
    await attach("droid");
    const seen: unknown[] = [];
    subscribe("session:created", (payload) => seen.push(payload), "mini");

    fakes.get("droid")?.emit("session:created", { id: "elsewhere" });
    expect(seen).toEqual([]);

    fakes.get("mini")?.emit("session:created", { id: "here" });
    expect(seen).toEqual([{ id: "here" }]);
  });

  it("stops delivering from a host once it is detached", async () => {
    await attach("mini");
    const seen: unknown[] = [];
    subscribe("session:created", (payload) => seen.push(payload));

    detachHost("mini");
    fakes.get("mini")?.emit("session:created", { id: "ghost" });

    expect(seen).toEqual([]);
    expect(getHostConnection("mini")).toBeNull();
  });

  it("leaves the other hosts working when one goes down", async () => {
    await attach("mini");
    await attach("droid");
    rememberSessionHost("s-ios", "mini");
    rememberSessionHost("s-android", "droid");

    fakes.get("mini")?.setState("offline");

    await expect(
      getTransportForCommand("start_agent", { sessionId: "s-ios" }).invoke(
        "start_agent",
        { sessionId: "s-ios" },
      ),
    ).rejects.toThrow(/offline/);

    await expect(
      getTransportForCommand("start_agent", { sessionId: "s-android" }).invoke(
        "start_agent",
        { sessionId: "s-android" },
      ),
    ).resolves.toBe("droid");

    expect(getHostConnection("mini")?.state).toBe("offline");
    expect(getHostConnection("droid")?.state).toBe("ready");
  });

  it("marks a host's snapshot stale when its socket drops", async () => {
    await attach("mini");
    expect(getHostConnection("mini")?.state).toBe("ready");

    fakes.get("mini")?.setState("offline");
    // Read-only replay: the entry survives so the last snapshot stays on
    // screen, but it is no longer trusted as current.
    expect(getHostConnection("mini")?.hydrated).toBe(false);
  });

  it("fails fast for a host nobody is attached to", async () => {
    rememberSessionHost("s-gone", "studio");

    await expect(
      getTransportForCommand("list_sessions", { sessionId: "s-gone" }).invoke(
        "list_sessions",
        { sessionId: "s-gone" },
      ),
    ).rejects.toThrow(/not connected/);
    expect(localInvoke).not.toHaveBeenCalled();
  });
});
