/**
 * Can this Mac hand out a share link at all?
 *
 * Answered before the user clicks, so a missing prerequisite is explained in
 * the dialog rather than thrown at them after a spinner. PATH lookups and
 * in-memory tunnel state first; Tailscale is only diagnosed when nothing else
 * could carry the link, since that one shells out.
 */

import type { TailscaleStep } from "./tailscaleSetup";
import { getEndpoints } from "./endpoints";
import { enabledProviders } from "./remoteService";
import {
  cloudflaredMissingError,
  tailscaleNotReadyError,
  type ShareErrorPayload,
} from "./shareError";
import { diagnoseTailscale } from "./tailscaleSetup";
import { binaryOnPath, getTunnelState } from "./tunnelManager";

export interface ShareReadiness {
  ready: boolean;
  /** Why not, in the same shape a failed start would throw. */
  blocker?: ShareErrorPayload;
}

/**
 * A tunnel that is already up (or on its way) carries the link, so the quick
 * tunnel — and `cloudflared` with it — is only needed when nothing else can.
 */
function hasTunnelInFlight(): boolean {
  const live = getEndpoints().some((e) => e.kind !== "lan");
  const coming = enabledProviders().some((p) => {
    const status = getTunnelState(p).status;

    return status === "running" || status === "starting";
  });

  return live || coming;
}

export async function checkShareReadiness(): Promise<ShareReadiness> {
  if (hasTunnelInFlight() || binaryOnPath("cloudflared")) {
    return { ready: true };
  }

  // Nothing else can carry the link, so if the user picked Tailscale, its setup
  // is what to walk them through — Argus can fix most of it from Settings.
  if (enabledProviders().includes("tailscale")) {
    const diagnosis = await diagnoseTailscale();
    if (diagnosis.ready) {
      return { ready: true };
    }
    const blocking = diagnosis.steps.find(
      (step: TailscaleStep) => step.state === "fail",
    );
    if (blocking) {
      return {
        ready: false,
        blocker: tailscaleNotReadyError(
          blocking,
          blocking.detail ?? undefined,
        ).toPayload(),
      };
    }
  }

  return { ready: false, blocker: cloudflaredMissingError().toPayload() };
}
