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

  it("isn't offered without a registered client id", () => {
    expect(oauthAvailable("linear")).toBe(
      Boolean(process.env.ARGUS_LINEAR_CLIENT_ID),
    );
    expect(oauthAvailable("figma")).toBe(false);
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

  it.skipIf(Boolean(process.env.ARGUS_LINEAR_CLIENT_ID))(
    "gives up on an expired token it has no app to refresh with",
    async () => {
      store.secret = JSON.stringify({
        accessToken: "old",
        refreshToken: "r",
        expiresAt: 1,
      });
      await expect(freshAccessToken("linear")).resolves.toBeNull();
    },
  );
});
