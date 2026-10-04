import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AdbKeyInjector,
  adbKeyCommand,
  guestHasKeyboard,
} from "./emulator-adb-keys";

// `getevent -lp` from an API 36 AVD created with hw.keyboard=no: power and
// touch only, so every gRPC key is dropped.
const NO_KEYBOARD = `add device 1: /dev/input/event0
  name:     "gpio-keys"
  events:
    KEY (0001): KEY_POWER
add device 2: /dev/input/event1
  name:     "virtio_input_multi_touch_1"
  events:
    KEY (0001): BTN_TOOL_RUBBER       BTN_STYLUS
`;
const WITH_KEYBOARD = `${NO_KEYBOARD}add device 3: /dev/input/event12
  name:     "qwerty2"
  events:
    KEY (0001): KEY_ESC               KEY_1                 KEY_Q                 KEY_W
`;

describe("guestHasKeyboard", () => {
  it("sees the qwerty2 keyboard of an hw.keyboard=yes AVD", () => {
    expect(guestHasKeyboard(WITH_KEYBOARD)).toBe(true);
  });

  it("is false for an AVD with only power and touch", () => {
    expect(guestHasKeyboard(NO_KEYBOARD)).toBe(false);
  });
});

describe("adbKeyCommand", () => {
  it("sends a plain key as a keyevent", () => {
    expect(adbKeyCommand(3, 0)).toBe("input keyevent 3");
  });

  it("holds the modifiers in metaState", () => {
    expect(adbKeyCommand(29, 0x1 | 0x1000)).toBe(
      "input keycombination 59 113 29",
    );
  });

  it("drops the modifier keys themselves", () => {
    expect(adbKeyCommand(59, 0x1)).toBeNull();
  });
});

describe("adb key injector", () => {
  let dir: string;
  let out: string;
  let adb: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "adbkeys-"));
    out = path.join(dir, "stdin.txt");
    adb = path.join(dir, "adb");
    fs.writeFileSync(adb, `#!/bin/sh\ncat >> "${out}"\n`, { mode: 0o755 });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("types through one adb shell, batching keys that arrive together", async () => {
    const keys = new AdbKeyInjector(adb, "emulator-5554");
    keys.press(29);
    keys.press(30);
    keys.press(29, 0x1);
    keys.press(4);
    await new Promise((r) => setTimeout(r, 50));
    keys.close();

    await expect
      .poll(() => (fs.existsSync(out) ? fs.readFileSync(out, "utf8") : ""))
      .toBe(
        "input keyevent 29 30\ninput keycombination 59 29\ninput keyevent 4\n",
      );
  });
});
