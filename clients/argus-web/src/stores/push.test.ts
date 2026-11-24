// @vitest-environment jsdom
import type { Transport } from "@argus/remote-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "./connection";
import { resetHostStores } from "./hostSync";
import { usePushStore } from "./push";

function fakeTransport() {
  const request = vi.fn(async (..._args: unknown[]) => ({ accepted: true }));
  useConnectionStore.setState({
    transport: { request } as unknown as Transport,
    connection: "ready",
  });

  return request;
}

afterEach(() => {
  resetHostStores();
  localStorage.clear();
  usePushStore.setState({ alerts: { needs_you: true, finished: true } });
});

describe("alert categories", () => {
  it("keeps the choice and tells the computer", async () => {
    const request = fakeTransport();
    await usePushStore.getState().setAlert("finished", false);

    expect(usePushStore.getState().alerts).toEqual({
      needs_you: true,
      finished: false,
    });
    expect(JSON.parse(localStorage.getItem("argus.alerts")!)).toEqual({
      needs_you: true,
      finished: false,
    });
    expect(request.mock.calls[0]?.slice(0, 2)).toEqual([
      "device.set_notifications",
      { needs_you: true, finished: false },
    ]);
  });
});
