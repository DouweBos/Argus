// @vitest-environment jsdom
import type { Transport } from "@argus/remote-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "./connection";
import { useDeviceHostsStore } from "./deviceHosts";
import { resetHostStores } from "./hostSync";
import { useIntegrationsStore } from "./integrations";

const host = {
  id: "eh1",
  label: "Expo",
  status: "connected" as const,
  kind: "eas" as const,
  running_sessions: 0,
  max_sessions: 2,
};

function fakeTransport(handlers: Record<string, (p: unknown) => unknown>) {
  const request = vi.fn(async (method: string, params: unknown) => {
    const handler = handlers[method];
    if (!handler) {
      throw Object.assign(new Error(`no ${method}`), { code: "not_found" });
    }

    return handler(params);
  });
  useConnectionStore.setState({
    transport: { request } as unknown as Transport,
    connection: "ready",
  });

  return request;
}

beforeEach(() => resetHostStores());

describe("device hosts", () => {
  it("starts an EAS session and refreshes the running count", async () => {
    let running = 0;
    const request = fakeTransport({
      "device_hosts.list": () => ({
        hosts: [{ ...host, running_sessions: running }],
      }),
      "device_hosts.start_eas_session": () => {
        running = 1;

        return { device_id: "eas:eh1:1" };
      },
    });

    await useDeviceHostsStore.getState().startEasSession("eh1");

    expect(request).toHaveBeenCalledWith("device_hosts.start_eas_session", {
      host_id: "eh1",
    });
    await vi.waitFor(() =>
      expect(useDeviceHostsStore.getState().hosts[0]?.running_sessions).toBe(
        1,
      ),
    );
  });

  it("ends an EAS device's session", async () => {
    const request = fakeTransport({
      "device_hosts.stop_eas_session": () => ({ accepted: true }),
    });

    await useDeviceHostsStore.getState().stopEasSession("eas:eh1:1");

    expect(request).toHaveBeenCalledWith("device_hosts.stop_eas_session", {
      device_id: "eas:eh1:1",
    });
  });

  it("forgets the last computer's hosts and integrations on a switch", async () => {
    fakeTransport({
      "device_hosts.list": () => ({ hosts: [host] }),
      "integrations.list": () => ({ integrations: [] }),
    });
    await useDeviceHostsStore.getState().refreshDeviceHosts();
    await useIntegrationsStore.getState().refreshIntegrations();
    expect(useDeviceHostsStore.getState().hosts).toHaveLength(1);
    expect(useIntegrationsStore.getState().integrationsLoad.loaded).toBe(true);

    resetHostStores();

    expect(useDeviceHostsStore.getState().hosts).toEqual([]);
    expect(useIntegrationsStore.getState().integrationsLoad.loaded).toBe(false);
  });
});
