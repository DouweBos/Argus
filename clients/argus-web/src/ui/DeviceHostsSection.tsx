/**
 * The computer's device hosts on the Devices screen. An EAS host can start a
 * session, billed to the Expo account on the computer, so it is control-only
 * and asks first, as iOS's `EasHostRow` does.
 */

import { useCallback, useMemo, useState } from "react";
import {
  ConfirmDialog,
  DeviceHostList,
  type DeviceHostNote,
  SidebarSection,
} from "@argus/peacock";
import {
  deviceHostView,
  describeError,
  EAS_START_CONFIRM,
  EAS_START_TITLE,
  EAS_STARTING_NOTE,
  easStartMessage,
} from "@argus/client-core";
import { capture } from "../telemetry/telemetry";
import { useConnectionStore } from "../stores/connection";
import { useDeviceHostsStore } from "../stores/deviceHosts";
import { useLiveRefresh } from "./useLiveRefresh";

export function DeviceHostsSection() {
  const connection = useConnectionStore((s) => s.connection);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const hosts = useDeviceHostsStore((s) => s.hosts);
  const load = useDeviceHostsStore((s) => s.hostsLoad);
  const refreshDeviceHosts = useDeviceHostsStore((s) => s.refreshDeviceHosts);
  const startEasSession = useDeviceHostsStore((s) => s.startEasSession);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<
    Record<string, DeviceHostNote | undefined>
  >({});

  const refresh = useCallback(() => {
    refreshDeviceHosts({ background: true }).catch(() => {});
  }, [refreshDeviceHosts]);
  useLiveRefresh(connection === "ready", refresh);

  const rows = useMemo(() => hosts.map(deviceHostView), [hosts]);

  const settle = (confirmed: boolean) => {
    const hostId = confirming;
    setConfirming(null);
    capture("web_eas_session_start_prompted", {
      outcome: confirmed ? "confirmed" : "cancelled",
    });
    if (!confirmed || !hostId) {
      return;
    }
    setBusyId(hostId);
    setNotes((n) => ({ ...n, [hostId]: undefined }));
    startEasSession(hostId)
      .then(
        () => setNotes((n) => ({ ...n, [hostId]: { text: EAS_STARTING_NOTE } })),
        (err: unknown) =>
          setNotes((n) => ({
            ...n,
            [hostId]: { text: describeError(err), failed: true },
          })),
      )
      .finally(() => setBusyId(null));
  };

  // Nothing to say about a computer with no device hosts, or to a guest the
  // list is refused to; a failed refresh behind rows still shows.
  if (rows.length === 0) {
    return null;
  }

  return (
    <>
      <SidebarSection count={rows.length}>Device hosts</SidebarSection>
      <DeviceHostList
        busyId={busyId}
        error={load.error}
        footer="Add or remove device hosts, and set Expo tokens, in Argus on the computer."
        hosts={rows}
        notes={notes}
        onRetry={() => {
          refreshDeviceHosts().catch(() => {});
        }}
        onStart={hasControl ? setConfirming : undefined}
      />
      {confirming && (
        <ConfirmDialog
          confirmLabel={EAS_START_CONFIRM}
          title={EAS_START_TITLE}
          titleId="web-eas-start-confirm"
          onCancel={() => settle(false)}
          onConfirm={() => settle(true)}
        >
          <p>{easStartMessage(null)}</p>
        </ConfirmDialog>
      )}
    </>
  );
}
