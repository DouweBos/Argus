/**
 * Loopback pairing for dev builds (see `@argus/host/services/remote/devTrust`).
 * Gated on an unpackaged build — the check that actually matters.
 */

import { app } from "electron";
import {
  startDevTrust as startHostDevTrust,
  stopDevTrust,
} from "@argus/host/services/remote/devTrust";

export { stopDevTrust };

export function startDevTrust(): Promise<void> {
  return startHostDevTrust(!app.isPackaged);
}
