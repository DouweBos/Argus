/**
 * Can this Mac hand out a share link at all?
 *
 * Answered before the user clicks, so a missing prerequisite is explained in
 * the dialog rather than thrown at them after a spinner. A tunnel that is up
 * carries the link; otherwise a quick tunnel needs `cloudflared`, which Argus
 * installs itself wherever a pinned release exists.
 */

import { canInstallCloudflared, findCloudflared } from "./cloudflared";
import { getEndpoints } from "./endpoints";
import { cloudflaredMissingError, type ShareErrorPayload } from "./shareError";
import { getTunnelState } from "./tunnelManager";

export interface ShareReadiness {
  ready: boolean;
  /** Why not, in the same shape a failed start would throw. */
  blocker?: ShareErrorPayload;
}

/** A guest's browser needs a public `wss://` route, up or on its way. */
function hasTunnelInFlight(): boolean {
  const live = getEndpoints().some((e) => e.url.startsWith("wss://"));
  const coming = (["tailscale", "cloudflare"] as const).some(
    (p) => getTunnelState(p).status === "starting",
  );

  return live || coming;
}

export async function checkShareReadiness(): Promise<ShareReadiness> {
  if (
    hasTunnelInFlight() ||
    canInstallCloudflared() ||
    (await findCloudflared())
  ) {
    return { ready: true };
  }

  return { ready: false, blocker: cloudflaredMissingError().toPayload() };
}
