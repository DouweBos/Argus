import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@argus/peacock";
import {
  EAS_START_CONFIRM,
  EAS_START_TITLE,
  easHostIdOf,
  easStartMessage,
  isBillableEasStart,
} from "../../lib/easBilling";
import { listEasDeviceHosts } from "../../lib/ipc";
import { capture } from "../../lib/telemetry";

interface Pending {
  message: string;
  resolve: (ok: boolean) => void;
}

/**
 * Asks before a boot that would start a billed EAS Simulator session.
 * `confirmStart` resolves true straight away for anything else; render `dialog`.
 */
export function useEasStartConfirm(): {
  confirmStart: (deviceId: string, running: boolean) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((ok: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (current) {
      capture("eas_session_start_prompted", {
        outcome: ok ? "confirmed" : "cancelled",
      });
      current.resolve(ok);
    }
  }, []);

  // An unmounted asker can't answer; treat it as cancelled.
  useEffect(() => () => pendingRef.current?.resolve(false), []);

  const confirmStart = useCallback(
    async (deviceId: string, running: boolean): Promise<boolean> => {
      if (!isBillableEasStart(deviceId, running)) {
        return true;
      }
      const hostId = easHostIdOf(deviceId);
      const host = await listEasDeviceHosts()
        .then((hosts) => hosts.find((h) => h.id === hostId) ?? null)
        .catch(() => null);
      // A newer ask replaces an unanswered one.
      pendingRef.current?.resolve(false);

      return new Promise<boolean>((resolve) => {
        const next = { message: easStartMessage(host), resolve };
        pendingRef.current = next;
        setPending(next);
      });
    },
    [],
  );

  const dialog = pending ? (
    <ConfirmDialog
      confirmLabel={EAS_START_CONFIRM}
      title={EAS_START_TITLE}
      titleId="eas-start-confirm"
      onCancel={() => settle(false)}
      onConfirm={() => settle(true)}
    >
      <p>{pending.message}</p>
    </ConfirmDialog>
  ) : null;

  return { confirmStart, dialog };
}
