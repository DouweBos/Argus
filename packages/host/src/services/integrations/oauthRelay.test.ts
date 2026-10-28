import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  process.env.ARGUS_FIGMA_CLIENT_ID = "figma-client";
  process.env.ARGUS_FIGMA_RELAY_URL = "https://relay.test/argus/figma";

  return {
    secret: JSON.stringify({
      accessToken: "old",
      refreshToken: "r1",
      expiresAt: 1,
    }),
    saved: [] as { secret: string }[],
  };
});

vi.mock("./credentials", () => ({
  loadIntegration: () => ({
    method: "oauth",
    account: { name: "Ann", email: null, workspace: null },
  }),
  readSecret: () => store.secret,
  saveIntegration: (_id: string, entry: { secret: string }) =>
    store.saved.push(entry),
}));

const { freshAccessToken, oauthAvailable } = await import("./oauth");

describe("figma oauth through the relay", () => {
  it("is offered once a client id is configured", () => {
    expect(oauthAvailable("figma")).toBe(true);
  });

  it("refreshes through the relay, never Figma, and sends no client secret", async () => {
    const fetchSpy = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({ access_token: "new", expires_in: 7776000 }),
          {
            status: 200,
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(freshAccessToken("figma")).resolves.toBe("new");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://relay.test/argus/figma/refresh");
    expect(JSON.parse(String(init.body))).toEqual({ refresh_token: "r1" });
    // Figma's refresh answer has no new refresh token; the old one is kept.
    expect(JSON.parse(store.saved[0].secret)).toMatchObject({
      accessToken: "new",
      refreshToken: "r1",
    });
    vi.unstubAllGlobals();
  });
});
