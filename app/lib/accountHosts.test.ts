import type { AccountHost } from "./types";
import type { RemoteHost } from "../stores/settingsStore";
import { describe, expect, it } from "vitest";
import { mergeAccountHosts, preferredUrl } from "./accountHosts";

const key = { device_id: "dev", noise_priv: "cHJpdg==", noise_pub: "cHVi" };

function accountHost(overrides: Partial<AccountHost> = {}): AccountHost {
  return {
    host_id: "mini",
    name: "Mac mini",
    platform: "darwin",
    noise_pub: "bWluaQ==",
    endpoints: [
      { kind: "cloudflare", url: "wss://quick.example", priority: 2 },
      { kind: "lan", url: "ws://10.0.0.2:47615", priority: 0 },
    ],
    last_seen: 1,
    online: true,
    is_self: false,
    ...overrides,
  };
}

function paired(overrides: Partial<RemoteHost> = {}): RemoteHost {
  return {
    id: "paired-1",
    label: "Paired mini",
    url: "wss://old.example",
    devPrivB64: "a",
    devPubB64: "b",
    hostPubB64: "bWluaQ==",
    capabilities: ["monitor"],
    pairedAt: 1,
    ...overrides,
  };
}

describe("account hosts", () => {
  it("dials the best-ranked endpoint first", () => {
    expect(preferredUrl(accountHost())).toBe("ws://10.0.0.2:47615");
  });

  it("adds a computer from the account with this window's device key", () => {
    const { upsert, forget } = mergeAccountHosts([], [accountHost()], key);
    expect(upsert).toEqual([
      expect.objectContaining({
        id: "mini",
        url: "ws://10.0.0.2:47615",
        hostPubB64: "bWluaQ==",
        devPrivB64: key.noise_priv,
        source: "account",
      }),
    ]);
    expect(forget).toEqual([]);
  });

  it("keeps a QR pairing to the same computer and only moves its address", () => {
    const { upsert } = mergeAccountHosts([paired()], [accountHost()], key);
    expect(upsert).toEqual([
      expect.objectContaining({ id: "paired-1", url: "ws://10.0.0.2:47615" }),
    ]);
  });

  it("hands the transport every route, best first", () => {
    const { upsert } = mergeAccountHosts([], [accountHost()], key);
    expect(upsert[0].endpoints?.map((e) => e.kind)).toEqual([
      "lan",
      "cloudflare",
    ]);
  });

  it("keeps the route that last worked while the account still lists it", () => {
    const current = paired({
      id: "mini",
      source: "account",
      url: "wss://quick.example",
      devPrivB64: key.noise_priv,
      devPubB64: key.noise_pub,
    });
    const { upsert } = mergeAccountHosts([current], [accountHost()], key);
    expect(upsert).toEqual([
      expect.objectContaining({ url: "wss://quick.example" }),
    ]);
  });

  it("skips this computer and forgets ones that left the account", () => {
    const gone = paired({
      id: "gone",
      hostPubB64: "Z29uZQ==",
      source: "account",
    });
    const { upsert, forget } = mergeAccountHosts(
      [gone],
      [accountHost({ is_self: true })],
      key,
    );
    expect(upsert).toEqual([]);
    expect(forget).toEqual(["gone"]);
  });

  it("forgets account computers once this window has no device key", () => {
    const linked = paired({ id: "mini", source: "account" });
    expect(mergeAccountHosts([linked], [accountHost()], null).forget).toEqual([
      "mini",
    ]);
  });
});
