/**
 * Handoff between the desktop and the iOS app.
 *
 * macOS advertises an `NSUserActivity` describing the session on screen; the
 * phone picks it up on the lock screen / app switcher, and vice versa. Both
 * apps ship under the same team, which is what lets Apple pair them.
 *
 * The two apps address screens differently — the desktop is session-centric,
 * the phone agent-centric — so the activity carries the identifiers rather
 * than a URL, and each side maps them onto its own route. `hostKey` is the
 * desktop's Noise static public key: the phone already pins it per pairing,
 * so it names *which computer* without inventing a second identity.
 */

import { app } from "electron";
import { getDesktopIdentity } from "@argus/host/services/remote/deviceStore";

export const ACTIVITY_TYPE = "dev.houwert.argus.session";

export interface ContinuityTarget {
  agentId?: string;
  label?: string;
  projectName?: string;
  repoRoot?: string;
  sessionId: string;
}

let cachedHostKey: Promise<string> | null = null;

/** base64url, matching the `ds_pub` the pairing payload hands the phone. */
function hostKey(): Promise<string> {
  cachedHostKey ??= getDesktopIdentity().then((id) =>
    Buffer.from(id.pub).toString("base64url"),
  );

  return cachedHostKey;
}

/** Advertise a session, or stop advertising when passed `null`. */
export async function publishActivity(
  target: ContinuityTarget | null,
): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }
  if (!target) {
    app.invalidateCurrentActivity();

    return;
  }
  const info: Record<string, string> = {
    hostKey: await hostKey(),
    sessionId: target.sessionId,
  };
  if (target.agentId) {
    info.agentId = target.agentId;
  }
  if (target.label) {
    info.label = target.label;
  }
  if (target.projectName) {
    info.projectName = target.projectName;
  }
  if (target.repoRoot) {
    info.repoRoot = target.repoRoot;
  }
  app.setUserActivity(ACTIVITY_TYPE, info);
}

async function resume(
  info: Record<string, unknown>,
  deliver: (path: string, agentId?: string) => void,
): Promise<void> {
  const sessionId = typeof info.sessionId === "string" ? info.sessionId : null;
  if (!sessionId) {
    return;
  }
  // A phone paired with two computers can hand off from either; only the one
  // that owns the session knows what the id means.
  if (info.hostKey !== (await hostKey())) {
    return;
  }
  const agentId = typeof info.agentId === "string" ? info.agentId : undefined;
  deliver(`/sessions/${sessionId}/agents`, agentId);
}

/** Accept an activity handed over from the phone. */
export function initContinuity(
  deliver: (path: string, agentId?: string) => void,
): void {
  if (process.platform !== "darwin") {
    return;
  }
  app.on("continue-activity", (event, type, userInfo) => {
    if (type !== ACTIVITY_TYPE) {
      return;
    }
    // Without this macOS treats the activity as unhandled and drops it.
    event.preventDefault();
    resume(userInfo as Record<string, unknown>, deliver).catch(() => undefined);
  });
}
