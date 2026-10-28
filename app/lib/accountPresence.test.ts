import { describe, expect, it } from "vitest";
import { presenceLabel } from "./accountPresence";

describe("presenceLabel", () => {
  const now = Date.UTC(2026, 9, 28, 12);

  it("says online, or offline with how long ago it was seen", () => {
    expect(presenceLabel({ online: true, last_seen: now }, now)).toBe("Online");
    expect(presenceLabel({ online: false, last_seen: null }, now)).toBe(
      "Offline",
    );
    expect(
      presenceLabel({ online: false, last_seen: now - 2 * 3_600_000 }, now),
    ).toMatch(/^Offline · last seen 2 hours ago$/);
    expect(
      presenceLabel({ online: false, last_seen: now - 20 * 60_000 }, now),
    ).toMatch(/^Offline · last seen 20 minutes ago$/);
  });
});
