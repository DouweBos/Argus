import { describe, expect, it } from "vitest";
import { KEYCODE_MAP, modifierFlagsFromEvent } from "./keycodeMap";

function fakeEvent(
  overrides: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    getModifierState: () => false,
    ...overrides,
  } as unknown as KeyboardEvent;
}

describe("KEYCODE_MAP", () => {
  it("maps Enter to keycode 36", () => {
    expect(KEYCODE_MAP.Enter).toBe(36);
  });

  it("maps Space to keycode 49", () => {
    expect(KEYCODE_MAP.Space).toBe(49);
  });

  it("maps Escape to keycode 53", () => {
    expect(KEYCODE_MAP.Escape).toBe(53);
  });

  it("maps arrow keys", () => {
    expect(KEYCODE_MAP.ArrowUp).toBe(126);
    expect(KEYCODE_MAP.ArrowDown).toBe(125);
    expect(KEYCODE_MAP.ArrowLeft).toBe(123);
    expect(KEYCODE_MAP.ArrowRight).toBe(124);
  });

  it("maps all letter keys", () => {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    for (const letter of letters) {
      const key = `Key${letter}`;
      expect(KEYCODE_MAP).toHaveProperty(key);
      expect(typeof KEYCODE_MAP[key]).toBe("number");
    }
  });

  it("maps all digit keys", () => {
    for (let i = 0; i <= 9; i++) {
      expect(KEYCODE_MAP).toHaveProperty(`Digit${i}`);
    }
  });

  it("maps all F-keys F1-F12", () => {
    for (let i = 1; i <= 12; i++) {
      expect(KEYCODE_MAP).toHaveProperty(`F${i}`);
    }
  });
});

describe("modifierFlagsFromEvent", () => {
  it("returns 0 for no modifiers", () => {
    expect(modifierFlagsFromEvent(fakeEvent())).toBe(0);
  });

  it("sets shift flag", () => {
    const flags = modifierFlagsFromEvent(fakeEvent({ shiftKey: true }));
    expect(flags & 0x20000).toBe(0x20000);
  });

  it("sets ctrl flag", () => {
    const flags = modifierFlagsFromEvent(fakeEvent({ ctrlKey: true }));
    expect(flags & 0x40000).toBe(0x40000);
  });

  it("sets alt flag", () => {
    const flags = modifierFlagsFromEvent(fakeEvent({ altKey: true }));
    expect(flags & 0x80000).toBe(0x80000);
  });

  it("sets meta flag", () => {
    const flags = modifierFlagsFromEvent(fakeEvent({ metaKey: true }));
    expect(flags & 0x100000).toBe(0x100000);
  });

  it("sets CapsLock flag", () => {
    const flags = modifierFlagsFromEvent(
      fakeEvent({
        getModifierState: (key: string) => key === "CapsLock",
      } as Partial<KeyboardEvent>),
    );
    expect(flags & 0x10000).toBe(0x10000);
  });

  it("combines multiple modifiers", () => {
    const flags = modifierFlagsFromEvent(
      fakeEvent({ shiftKey: true, metaKey: true }),
    );
    expect(flags & 0x20000).toBe(0x20000); // shift
    expect(flags & 0x100000).toBe(0x100000); // meta
  });
});
