/**
 * Pairing from the terminal the host runs in — the console the root of trust
 * needs, for a host with no window and no tray. Drives the same state machine
 * as Argus Server.app's tray, SAS comparison included.
 */

import type { Interface } from "node:readline";
import {
  cancelServerPairing,
  confirmServerPairing,
  getServerPairingState,
  setServerPairingListener,
  startServerPairing,
} from "../services/remote/serverPairing";

const GRANTS: Record<string, { admin: boolean; control: boolean }> = {
  a: { admin: true, control: true },
  c: { admin: false, control: true },
  v: { admin: false, control: false },
};

export function attachConsolePairing(
  rl: Interface,
  print: (line: string) => void,
): void {
  setServerPairingListener(() => {
    const state = getServerPairingState();
    switch (state.kind) {
      case "armed":
        print(
          "Waiting for a device. Enter the code above on it (also written to pairing-code.txt).",
        );
        break;
      case "awaiting_sas":
        print(`Confirm the device shows: ${state.sas}`);
        print(
          "Grant [a]dmin (another Mac), [c]ontrol, [v]iew only, or [r]eject?",
        );
        break;
      case "paired":
        print(`Paired "${state.label}".`);
        break;
      case "error":
        print(`Pairing failed: ${state.message}`);
        break;
      case "idle":
        break;
    }
  });

  rl.on("line", (input) => {
    const answer = input.trim().toLowerCase();
    const state = getServerPairingState();
    if (state.kind === "awaiting_sas") {
      if (answer === "r") {
        cancelServerPairing();
        print("Rejected.");
      } else if (GRANTS[answer]) {
        confirmServerPairing(GRANTS[answer]).catch(() => undefined);
      } else {
        print("Answer a, c, v or r.");
      }

      return;
    }
    if (answer === "pair") {
      startServerPairing({
        publishCode: (code) => print(`Pairing code:\n\n  ${code}\n`),
      }).catch(() => undefined);
    } else if (answer === "cancel") {
      cancelServerPairing();
    } else if (answer) {
      print("Commands: pair, cancel. Ctrl-C to stop the host.");
    }
  });
}
