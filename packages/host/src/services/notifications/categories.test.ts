import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

const { capture } = vi.mocked(await import("../telemetry/telemetry"));
const {
  captureCategoryChanges,
  desktopNotificationPrefs,
  notificationCategory,
  wantsNotification,
} = await import("./categories");

describe("notification categories", () => {
  beforeEach(() => capture.mockClear());

  it("puts only finished turns under finished", () => {
    expect(notificationCategory("finished")).toBe("finished");
    expect(notificationCategory("failed")).toBe("needs_you");
    expect(notificationCategory("permission")).toBe("needs_you");
    expect(notificationCategory("push")).toBe("needs_you");
  });

  it("lets everything through without a choice", () => {
    expect(wantsNotification(undefined, "finished")).toBe(true);
    expect(
      wantsNotification({ needs_you: true, finished: false }, "finished"),
    ).toBe(false);
  });

  it("defaults the desktop's banners on", () => {
    expect(desktopNotificationPrefs({})).toEqual({
      needs_you: true,
      finished: true,
    });
    expect(desktopNotificationPrefs({ notify_finished: false })).toEqual({
      needs_you: true,
      finished: false,
    });
  });

  it("captures only the categories that flipped", () => {
    captureCategoryChanges("device", undefined, {
      needs_you: true,
      finished: false,
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("notification_category_changed", {
      category: "finished",
      on: false,
      surface: "device",
    });
  });
});
