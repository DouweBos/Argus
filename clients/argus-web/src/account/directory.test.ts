import { verifyLog } from "@argus/remote-protocol/account";
import { describe, expect, it } from "vitest";
import {
  accountComputers,
  browserRoutes,
  isOnline,
  mergePresence,
  ONLINE_WINDOW_MS,
} from "./directory";
import { FakeAccountService, miniKeys } from "./fakeAccountService";

const LAN = { kind: "lan" as const, url: "ws://10.0.0.2:47615", priority: 0 };
const TAILNET = { kind: "tailscale" as const, url: "ws://100.64.1.2:47615", priority: 1 };
const TUNNEL = {
  kind: "cloudflare" as const,
  url: "wss://argus-0123456789abcdef.houwert.dev",
  priority: 2,
};

function verified(fake: FakeAccountService) {
  const result = verifyLog(fake.entries);
  if (!result.ok) {
    throw new Error(result.reason);
  }

  return result.state;
}

describe("browserRoutes", () => {
  it("keeps only wss routes, best first, once each", () => {
    const other = { kind: "cloudflare" as const, url: "wss://b.example", priority: 1 };
    expect(browserRoutes([TUNNEL, LAN, TAILNET, other, TUNNEL])).toEqual([other, TUNNEL]);
  });

  it("leaves nothing for a computer reachable only on its LAN", () => {
    expect(browserRoutes([LAN, TAILNET])).toEqual([]);
  });
});

describe("account directory", () => {
  it("lists live hosts with their verified tunnel and online state", () => {
    const fake = new FakeAccountService().seed();
    fake.publish([LAN, TUNNEL], 100, 1_000);
    const state = verified(fake);
    const presence = mergePresence(state, {}, fake.records);
    const [mini] = accountComputers(state, presence, 1_000 + ONLINE_WINDOW_MS);

    expect(mini).toMatchObject({ id: miniKeys.id, name: "Mini", online: true, routes: [TUNNEL] });
    expect(accountComputers(state, presence, 1_001 + ONLINE_WINDOW_MS)[0].online).toBe(false);
  });

  it("drops a record whose signature doesn't verify", () => {
    const fake = new FakeAccountService().seed();
    fake.publish([TUNNEL], 100, 1_000);
    const forged = {
      ...fake.records[0],
      presence_body: fake.records[0].presence_body.replace("argus-0123", "argus-evil"),
    };
    expect(mergePresence(verified(fake), {}, [forged])).toEqual({});
  });

  it("keeps a newer record over an older one", () => {
    const fake = new FakeAccountService().seed();
    const state = verified(fake);
    fake.publish([TUNNEL], 200, 2_000);
    const held = mergePresence(state, {}, fake.records);
    fake.publish([LAN], 100, 3_000);
    expect(mergePresence(state, held, fake.records)[miniKeys.id].endpoints).toEqual([TUNNEL]);
  });

  it("counts a host never seen as offline", () => {
    expect(isOnline(null, 5)).toBe(false);
  });
});
