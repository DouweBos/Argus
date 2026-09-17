// @vitest-environment jsdom
import type { ArgusTransport } from "../lib/transport/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDeviceClaim } from "./useDeviceClaim";

type Listener = (payload: unknown, hostId: string) => void;

/** One fake host: its request log, its canned claim, its event listeners. */
function makeHost(selfDeviceId: string) {
  const calls: { args: Record<string, unknown>; channel: string }[] = [];
  const listeners = new Set<Listener>();
  const state = {
    calls,
    listeners,
    selfDeviceId,
    holder: null as unknown,
  };
  const transport: ArgusTransport = {
    invoke: vi.fn((channel: string, args?: Record<string, unknown>) => {
      calls.push({ channel, args: args ?? {} });
      if (channel === "devices.claim_status") {
        return Promise.resolve({ holder: state.holder });
      }
      if (channel === "devices.claim") {
        return Promise.resolve({
          granted: true,
          holder: {
            connection_id: "c-self",
            device_id: selfDeviceId,
            label: "This Mac",
          },
        });
      }

      return Promise.resolve({ accepted: true });
    }) as ArgusTransport["invoke"],
    send: vi.fn(),
    on: vi.fn(() => () => undefined),
    media: { register: vi.fn(), push: vi.fn(), clear: vi.fn() } as never,
  };

  return Object.assign(state, { transport });
}

const hosts = new Map<string, ReturnType<typeof makeHost>>();

vi.mock("../lib/transport", () => ({
  getTransportFor: (hostId: string) => hosts.get(hostId)!.transport,
  subscribe: (event: string, cb: Listener, hostId?: string) => {
    if (!event || !hostId) {
      return () => undefined;
    }
    const host = hosts.get(hostId)!;
    const listener: Listener = (payload) => cb(payload, hostId);
    host.listeners.add(listener);

    return () => host.listeners.delete(listener);
  },
}));

vi.mock("../stores/connectionStore", () => ({
  useHostConnection: () => ({ state: "ready" }),
}));

vi.mock("../stores/settingsStore", () => ({
  getRemoteHost: (hostId: string) => {
    const host = hosts.get(hostId);

    return host ? { id: host.selfDeviceId } : null;
  },
}));

function emit(hostId: string, payload: unknown) {
  for (const listener of [...hosts.get(hostId)!.listeners]) {
    listener(payload, hostId);
  }
}

const OTHER = {
  connection_id: "c-phone",
  device_id: "dev-phone",
  label: "Douwe's iPhone",
};

describe("useDeviceClaim", () => {
  beforeEach(() => {
    hosts.clear();
    hosts.set("host-a", makeHost("dev-self"));
    hosts.set("host-b", makeHost("dev-self-b"));
  });

  it("seeds the holder from devices.claim_status", async () => {
    hosts.get("host-a")!.holder = OTHER;
    const { result } = renderHook(() =>
      useDeviceClaim("sim-1", "host-a", true),
    );

    await waitFor(() => expect(result.current.blocked).toBe(true));
    expect(result.current.holderLabel).toBe("Douwe's iPhone");
    expect(hosts.get("host-a")!.calls[0]).toEqual({
      channel: "devices.claim_status",
      args: { device_id: "sim-1" },
    });
  });

  it("stays unblocked when the claim is ours", async () => {
    hosts.get("host-a")!.holder = {
      connection_id: "c-self",
      device_id: "dev-self",
      label: "This Mac",
    };
    const { result } = renderHook(() =>
      useDeviceClaim("sim-1", "host-a", true),
    );

    await waitFor(() => expect(hosts.get("host-a")!.calls).toHaveLength(1));
    expect(result.current.blocked).toBe(false);
    expect(result.current.holderLabel).toBeNull();
  });

  it("follows the claim event, including the lapse back to free", async () => {
    const { result } = renderHook(() =>
      useDeviceClaim("sim-1", "host-a", true),
    );
    await waitFor(() => expect(result.current.blocked).toBe(false));

    act(() => emit("host-a", { device_id: "sim-1", holder: OTHER }));
    expect(result.current.blocked).toBe(true);

    // 30s idle lapsed on the host: the overlay must not stay stuck.
    act(() => emit("host-a", { device_id: "sim-1", holder: null }));
    expect(result.current.blocked).toBe(false);
    expect(result.current.holderLabel).toBeNull();
  });

  it("ignores claim events for another device on the same host", async () => {
    const { result } = renderHook(() =>
      useDeviceClaim("sim-1", "host-a", true),
    );
    await waitFor(() => expect(result.current.blocked).toBe(false));

    act(() => emit("host-a", { device_id: "sim-2", holder: OTHER }));
    expect(result.current.blocked).toBe(false);
  });

  it("does not let one host's claim block the same device on another", async () => {
    const a = renderHook(() => useDeviceClaim("sim-1", "host-a", true));
    const b = renderHook(() => useDeviceClaim("sim-1", "host-b", true));
    await waitFor(() => expect(a.result.current.blocked).toBe(false));

    act(() => emit("host-a", { device_id: "sim-1", holder: OTHER }));

    expect(a.result.current.blocked).toBe(true);
    expect(b.result.current.blocked).toBe(false);
  });

  it("takes control with force and clears the overlay", async () => {
    hosts.get("host-a")!.holder = OTHER;
    const { result } = renderHook(() =>
      useDeviceClaim("sim-1", "host-a", true),
    );
    await waitFor(() => expect(result.current.blocked).toBe(true));

    await act(async () => {
      result.current.takeControl();
    });

    expect(hosts.get("host-a")!.calls).toContainEqual({
      channel: "devices.claim",
      args: { device_id: "sim-1", force: true },
    });
    expect(result.current.blocked).toBe(false);
  });

  it("adopts the holder a refused input reports, in case it races the event", async () => {
    const { result } = renderHook(() =>
      useDeviceClaim("sim-1", "host-a", true),
    );
    await waitFor(() => expect(result.current.blocked).toBe(false));

    let handled = false;
    act(() => {
      handled = result.current.reportInputError({
        name: "RemoteError",
        code: "capability_denied",
        data: { device_id: "sim-1", holder: OTHER },
      });
    });

    expect(handled).toBe(true);
    expect(result.current.blocked).toBe(true);
  });

  it("passes non-claim errors through untouched", async () => {
    const { result } = renderHook(() =>
      useDeviceClaim("sim-1", "host-a", true),
    );
    await waitFor(() => expect(result.current.blocked).toBe(false));

    act(() => {
      expect(result.current.reportInputError(new Error("boom"))).toBe(false);
      expect(
        result.current.reportInputError({
          code: "capability_denied",
          data: { device_id: "sim-9", holder: OTHER },
        }),
      ).toBe(false);
    });
    expect(result.current.blocked).toBe(false);
  });

  it("releases the claim on unmount instead of waiting out the idle lapse", async () => {
    const { unmount } = renderHook(() =>
      useDeviceClaim("sim-1", "host-a", true),
    );
    await waitFor(() => expect(hosts.get("host-a")!.calls).toHaveLength(1));

    unmount();

    expect(hosts.get("host-a")!.calls.at(-1)).toEqual({
      channel: "devices.release",
      args: { device_id: "sim-1" },
    });
  });

  it("never blocks at the host's own machine", () => {
    const { result } = renderHook(() => useDeviceClaim("sim-1", "local", true));

    expect(result.current.blocked).toBe(false);
    expect(result.current.holderLabel).toBeNull();
  });

  it("asks nothing while the view is inactive", async () => {
    renderHook(() => useDeviceClaim("sim-1", "host-a", false));

    await waitFor(() => expect(hosts.get("host-a")!.calls).toHaveLength(0));
  });
});
