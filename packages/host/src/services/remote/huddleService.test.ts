/**
 * Rooms against the public-URL lease: one lease per room, handed back however
 * the room ends. A leaked lease would leave a quick tunnel — and a live link —
 * running after the huddle is over.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));
vi.mock("./remoteService", () => ({
  acquirePublicUrl: vi.fn(async () => ({
    url: "wss://x.trycloudflare.com",
    webUrl: "https://x.trycloudflare.com",
    kind: "cloudflare",
    raised: true,
  })),
  releasePublicUrl: vi.fn(),
}));

const { acquirePublicUrl, releasePublicUrl } = vi.mocked(
  await import("./remoteService"),
);
const { startHuddle, stopHuddle, stopAllHuddles } =
  await import("./huddleService");
const { endAllRooms, resetRooms, sweepRooms } = await import("./huddle");

const start = () =>
  startHuddle({ agent_id: "ag1", device_key: "udid-1", ttl_ms: 60_000 });

describe("a huddle's public URL", () => {
  beforeEach(() => {
    resetRooms();
    vi.clearAllMocks();
  });
  afterEach(() => {
    endAllRooms();
    resetRooms();
  });

  it("takes one lease and builds the share link from it", async () => {
    const room = await start();

    expect(acquirePublicUrl).toHaveBeenCalledTimes(1);
    expect(room.url).toBe(`https://x.trycloudflare.com/#/huddle/${room.token}`);
  });

  it("gives the lease back when the room ends", async () => {
    const room = await start();

    expect(releasePublicUrl).not.toHaveBeenCalled();
    expect(stopHuddle(room.id)).toBe(true);
    expect(releasePublicUrl).toHaveBeenCalledTimes(1);
  });

  it("gives it back on expiry too", async () => {
    const room = await start();
    sweepRooms(room.expires_at);

    expect(releasePublicUrl).toHaveBeenCalledTimes(1);
  });

  it("releases one lease per room on shutdown", async () => {
    await start();
    await start();
    stopAllHuddles();

    expect(releasePublicUrl).toHaveBeenCalledTimes(2);
  });

  it("never releases twice for one room", async () => {
    const room = await start();
    stopHuddle(room.id);
    stopHuddle(room.id);
    stopAllHuddles();

    expect(releasePublicUrl).toHaveBeenCalledTimes(1);
  });
});
