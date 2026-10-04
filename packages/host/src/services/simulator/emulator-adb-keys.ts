/**
 * Key input for emulators whose guest has no keyboard device.
 *
 * The gRPC `sendKey` writes to the guest's virtual keyboard, which only exists
 * when the AVD has `hw.keyboard=yes`. AVDs created by `avdmanager` (and many by
 * hand) don't, and on them every gRPC key — Home and Back included — is
 * silently dropped. `input keyevent` works on any image, so keys go there.
 */

import { spawn, type ChildProcess } from "node:child_process";

/** True when some guest input device can type, i.e. gRPC keys will land. */
export function guestHasKeyboard(geteventLp: string): boolean {
  return /\bKEY_Q\b/.test(geteventLp);
}

/** AKEYCODE_* modifiers; the renderer sends them as keys and as `metaState`. */
const MODIFIER_KEYCODES = new Set([57, 58, 59, 60, 113, 114, 117, 118]);

/** Android `KeyEvent.META_*_ON` bits → the modifier key to hold. */
const META_KEYCODES: [number, number][] = [
  [0x1, 59], // SHIFT
  [0x2, 57], // ALT
  [0x1000, 113], // CTRL
  [0x10000, 117], // META
];

/** The `input` command for a key-down, or null when there is nothing to send. */
export function adbKeyCommand(
  keyCode: number,
  metaState: number,
): string | null {
  if (MODIFIER_KEYCODES.has(keyCode)) {
    return null;
  }
  const held = META_KEYCODES.filter(([bit]) => metaState & bit).map(
    ([, code]) => code,
  );
  if (held.length > 0) {
    return `input keycombination ${[...held, keyCode].join(" ")}`;
  }

  return `input keyevent ${String(keyCode)}`;
}

/**
 * One long-lived `adb shell`, so a key costs a line on stdin rather than an
 * adb round trip. Plain keys that arrive together go out as one `input`.
 */
export class AdbKeyInjector {
  private shell: ChildProcess | null = null;
  private pending: number[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly adbPath: string,
    private readonly serial: string,
  ) {}

  press(keyCode: number, metaState = 0): void {
    const command = adbKeyCommand(keyCode, metaState);
    if (!command) {
      return;
    }
    if (command.startsWith("input keyevent ")) {
      this.pending.push(keyCode);
      this.flushTimer ??= setTimeout(() => this.flush(), 15);

      return;
    }
    this.flush();
    this.write(command);
  }

  close(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pending = [];
    // Closing stdin ends the shell once it has run what it was sent.
    const shell = this.shell;
    this.shell = null;
    shell?.stdin?.end();
    setTimeout(() => shell?.kill(), 2000).unref();
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pending.length > 0) {
      this.write(`input keyevent ${this.pending.join(" ")}`);
      this.pending = [];
    }
  }

  private write(command: string): void {
    if (!this.shell || this.shell.exitCode !== null || this.shell.killed) {
      this.shell = spawn(this.adbPath, ["-s", this.serial, "shell"], {
        stdio: ["pipe", "ignore", "ignore"],
      });
      this.shell.stdin?.on("error", () => {
        // The shell went away; the next key starts another.
      });
      this.shell.on("error", () => {
        this.shell = null;
      });
    }
    this.shell.stdin?.write(`${command}\n`);
  }
}
