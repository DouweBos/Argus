import { describe, expect, it } from "vitest";
import { type ShortcutKey, usageShortcut } from "./usageShortcuts";

function key(over: Partial<ShortcutKey>): ShortcutKey {
  return {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...over,
  };
}

const mac = { mac: true, typing: false, tab: "cost" as const };

describe("usageShortcut", () => {
  it("switches tabs on bare letters", () => {
    expect(usageShortcut(key({ key: "t" }), mac)).toEqual({
      kind: "tab",
      tab: "tokens",
    });
    expect(usageShortcut(key({ key: "L" }), mac)).toEqual({
      kind: "tab",
      tab: "limits",
    });
    expect(usageShortcut(key({ key: "c", metaKey: true }), mac)).toBeNull();
  });

  it("ignores everything while typing in a field", () => {
    expect(
      usageShortcut(key({ key: "c" }), { ...mac, typing: true }),
    ).toBeNull();
  });

  it("picks a range with the platform's command key and shift", () => {
    const press = key({ key: "@", code: "Digit2", shiftKey: true });
    expect(usageShortcut({ ...press, metaKey: true }, mac)).toEqual({
      kind: "range",
      range: "7d",
    });
    expect(usageShortcut({ ...press, ctrlKey: true }, mac)).toBeNull();
    expect(
      usageShortcut({ ...press, ctrlKey: true }, { ...mac, mac: false }),
    ).toEqual({ kind: "range", range: "7d" });
  });

  it("has no range on Limits", () => {
    expect(
      usageShortcut(key({ code: "Digit1", shiftKey: true, metaKey: true }), {
        ...mac,
        tab: "limits",
      }),
    ).toBeNull();
  });

  it("goes back on Escape", () => {
    expect(usageShortcut(key({ key: "Escape" }), mac)).toEqual({
      kind: "back",
    });
  });
});
