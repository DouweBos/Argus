import { afterEach, describe, expect, it, vi } from "vitest";
import { getGatewayNonce, HEALTH_PATH } from "./gatewayHealth";
import { probeGatewayUrl, waitForPublicDns } from "./reachability";

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

describe("waitForPublicDns", () => {
  const notFound = () =>
    Object.assign(new Error("queryA ENOTFOUND"), { code: "ENOTFOUND" });

  it("waits until public DNS has the new hostname", async () => {
    let calls = 0;
    const resolve4 = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        throw notFound();
      }

      return ["104.16.230.132"];
    });

    await waitForPublicDns("demo.trycloudflare.com", {
      pollMs: 1,
      resolver: { resolve4 },
    });
    expect(resolve4).toHaveBeenCalledTimes(3);
  });

  it("stops waiting when public resolvers can't be reached", async () => {
    const resolve4 = vi.fn(async () => {
      throw Object.assign(new Error("queryA ECONNREFUSED"), {
        code: "ECONNREFUSED",
      });
    });

    await waitForPublicDns("demo.trycloudflare.com", {
      pollMs: 1,
      resolver: { resolve4 },
    });
    expect(resolve4).toHaveBeenCalledTimes(1);
  });

  it("gives up after its timeout", async () => {
    const resolve4 = vi.fn(async () => {
      throw notFound();
    });

    await waitForPublicDns("demo.trycloudflare.com", {
      timeoutMs: 20,
      pollMs: 5,
      resolver: { resolve4 },
    });
    expect(resolve4.mock.calls.length).toBeGreaterThan(1);
  });
});
