/** Touch, button and keyboard input for a captured iOS device. */

import type { DeviceInput } from "./deviceSource";
import { appState } from "../../state";
import { hidUsageForKeyCode, modifierUsages } from "./hidUsage";
import { captureSessionFor } from "./iosCapture";

/** The capture's input; throws when there's no capture to send it to. */
function inputFor(udid: string): DeviceInput {
  if (!appState.simulators.has(udid)) {
    throw "No active simulator session";
  }
  const session = captureSessionFor(udid);
  if (!session) {
    throw "Simulator bridge is not running";
  }

  return session.input;
}

/**
 * Inject a touch event into the simulator.
 *
 * `x` and `y` are normalized coordinates in [0.0, 1.0].
 * `eventType`: 0 = Down, 1 = Drag, 2 = Up.
 *
 * @throws string if there is no active simulator session for this UDID, or if
 *   the device rejects it.
 */
export async function simulatorTouch(
  udid: string,
  x: number,
  y: number,
  eventType: number,
): Promise<void> {
  await inputFor(udid).touch(x, y, eventType);
}

/**
 * Send a named button press (e.g. "home", "menu") to the simulator with the
 * given UDID, as a down+up pair.
 *
 * @throws string if there is no active session for this UDID, or the device
 *   rejects it.
 */
export async function simulatorButton(
  udid: string,
  button: string,
): Promise<void> {
  await inputFor(udid).button(button);
}

/**
 * Send a raw keyboard event (down or up) to the active simulator.
 *
 * Unlike {@link simulatorButton}, this accepts an arbitrary macOS virtual
 * keycode with no name mapping and no automatic down+up pairing. Modifiers are
 * pressed around the key from `modifierFlags`.
 *
 * @throws string if there is no active session, or the device rejects it.
 */
export async function simulatorKeyboard(
  udid: string,
  keyCode: number,
  modifierFlags: number,
  isDown: boolean,
): Promise<void> {
  const input = inputFor(udid);

  const usage = hidUsageForKeyCode(keyCode);
  if (usage === null) {
    throw `Keyboard failed: no HID usage for key code ${String(keyCode)}`;
  }

  // Modifiers are plain key presses to the guest: hold them around the key so
  // chords land, pressing before the key down and releasing after the key up.
  const modifiers = modifierUsages(modifierFlags);
  for (const modifier of isDown ? modifiers : []) {
    await input.key(modifier, true);
  }
  await input.key(usage, isDown);
  for (const modifier of isDown ? [] : modifiers) {
    await input.key(modifier, false);
  }
}
