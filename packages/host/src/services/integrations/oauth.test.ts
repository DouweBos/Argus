import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  entry: null as {
    method: "oauth";
    account: { name: string; email: null; workspace: null };
  } | null,
  secret: null as string | null,
  saved: [] as { secret: string }[],
}));

vi.mock("./credentials", () => ({
  loadIntegration: () => store.entry,
  readSecret: () => store.secret,
  saveIntegration: (_id: string, entry: { secret: string }) =>
    store.saved.push(entry),
}));

const { freshAccessToken, oauthAvailable, parseTokens } =
  await import("./oauth");

describe("integration oauth", () => {
  beforeEach(() => {
    store.entry = {
      method: "oauth",
      account: { name: "Ann", email: null, workspace: null },
    };
    store.saved = [];
    vi.unstubAllGlobals();
  });

  it("is offered for both registered apps", () => {
    expect(oauthAvailable("linear")).toBe(true);
    expect(oauthAvailable("figma")).toBe(true);
  });

  it("parses stored tokens and rejects anything else", () => {
    expect(
      parseTokens('{"accessToken":"a","refreshToken":null,"expiresAt":null}'),
    ).toEqual({
      accessToken: "a",
      refreshToken: null,
      expiresAt: null,
    });
    expect(parseTokens("lin_api_plainkey")).toBeNull();
  });

  it("hands back a token that isn't close to expiring without refreshing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    store.secret = JSON.stringify({
      accessToken: "live",
      refreshToken: "r",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    await expect(freshAccessToken("linear")).resolves.toBe("live");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refreshes an expiring token once, however many callers ask", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ access_token: "new", expires_in: 3600 }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    store.secret = JSON.stringify({
      accessToken: "old",
      refreshToken: "r",
      expiresAt: 1,
    });
    const [a, b] = await Promise.all([
      freshAccessToken("linear"),
      freshAccessToken("linear"),
    ]);
    expect([a, b]).toEqual(["new", "new"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.saved[0].secret)).toMatchObject({
      accessToken: "new",
      refreshToken: "r",
    });
  });

  it("gives up when the refresh is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 400 }))),
    );
    store.secret = JSON.stringify({
      accessToken: "old",
      refreshToken: "r",
      expiresAt: 1,
    });
    await expect(freshAccessToken("linear")).resolves.toBeNull();
  });
});
