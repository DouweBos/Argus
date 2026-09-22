import type { DeviceClaimState } from "../../../hooks/useDeviceClaim";
import type { TvRemoteButton } from "@argus/peacock";
import { useCallback } from "react";
import { AppleTVRemote as TvRemote } from "@argus/peacock";
import { error } from "@logger";
import { simulatorButton } from "../../../lib/ipc";

interface AppleTVRemoteProps {
  /** Input arbitration on the host. Omitted where nothing can contend for it. */
  claim?: DeviceClaimState;
  udid: string;
}

/** Peacock's Siri Remote, wired to the local simulator over IPC. */
export function AppleTVRemote({ claim, udid }: AppleTVRemoteProps) {
  const blocked = claim?.blocked ?? false;
  const reportInputError = claim?.reportInputError;

  const handlePress = useCallback(
    (button: TvRemoteButton) => {
      simulatorButton(udid, button).catch((err) => {
        // A refusal means someone else took the device — say so rather than
        // dropping the press into the log.
        if (!reportInputError?.(err)) {
          error("[Remote] button failed:", err);
        }
      });
    },
    [reportInputError, udid],
  );

  return <TvRemote blocked={blocked} onPress={handlePress} />;
}
