/** Ends an EAS Simulator device's session, and its billing, after asking. */

import { useState } from "react";
import { Button, ConfirmDialog, Icons } from "@argus/peacock";
import {
  EAS_END_CONFIRM,
  EAS_END_MESSAGE,
  EAS_END_TITLE,
} from "@argus/client-core";
import { useDeviceHostsStore } from "../stores/deviceHosts";

export function EasEndSession({ deviceId }: { deviceId: string }) {
  const stopEasSession = useDeviceHostsStore((s) => s.stopEasSession);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        aria-label={EAS_END_CONFIRM}
        title={EAS_END_CONFIRM}
        onClick={() => setConfirming(true)}
      >
        <Icons.StopIcon size={16} />
      </Button>
      {confirming && (
        <ConfirmDialog
          destructive
          confirmLabel={EAS_END_CONFIRM}
          title={EAS_END_TITLE}
          titleId="web-eas-end-confirm"
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            stopEasSession(deviceId)
              .catch(() => {})
              .finally(() => setConfirming(false))
          }
        >
          <p>{EAS_END_MESSAGE}</p>
        </ConfirmDialog>
      )}
    </>
  );
}
