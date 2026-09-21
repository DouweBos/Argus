import { afterEach, describe, expect, it, vi } from "vitest";
import { getGatewayNonce, HEALTH_PATH } from "./gatewayHealth";
import { probeGatewayUrl } from "./reachability";

const NO_RETRY = { retryDelaysMs: [] };

function stubFetch(impl: (url: string) => unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => impl(url));
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

describe("probeGatewayUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts our own nonce over the tunnel's https origin", async () => {
    const fetchMock = stubFetch(() => ({
      ok: true,
      json: async () => ({ argus: true, nonce: getGatewayNonce() }),
    }));

    await expect(
      probeGatewayUrl("wss://mac.tail.ts.net", NO_RETRY),
    ).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://mac.tail.ts.net${HEALTH_PATH}`,
    );
  });

  it("rejects a 200 from something that isn't this gateway", async () => {
    stubFetch(() => ({
      ok: true,
      json: async () => ({ nonce: "someone-else" }),
    }));

    await expect(
      probeGatewayUrl("wss://mac.tail.ts.net", NO_RETRY),
    ).resolves.toBe(false);
  });

  it("treats a dead funnel's network error as unreachable", async () => {
    stubFetch(() => {
      throw new Error("getaddrinfo ENOTFOUND");
    });

    await expect(
      probeGatewayUrl("wss://mac.tail.ts.net", NO_RETRY),
    ).resolves.toBe(false);
  });

  it("retries, so a tunnel that is merely slow still counts", async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      if (calls === 1) {
        throw new Error("not yet");
      }

      return { ok: true, json: async () => ({ nonce: getGatewayNonce() }) };
    });

    await expect(
      probeGatewayUrl("wss://demo.trycloudflare.com", { retryDelaysMs: [1] }),
    ).resolves.toBe(true);
    expect(calls).toBe(2);
  });
});
