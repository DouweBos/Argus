/**
 * Every machine this window can drive — this Mac plus every paired host —
 * folded into the shape the Peacock host list renders, with the attach,
 * detach and focus actions wired up.
 */

import type { HostConnectionInfo } from "../stores/connectionStore";
import type { HostConnectionEntry, HostLinkState } from "@argus/peacock";
import { useCallback, useState } from "react";
import { useRouteHostId } from "../lib/routeHooks";
import { attachTo, detachFrom, focusHost } from "../lib/transport";
import { LOCAL_HOST_ID } from "../lib/transport/hostId";
import {
  useHostConnections,
  useUnreachableHosts,
} from "../stores/connectionStore";
import { pushError } from "../stores/notificationsStore";
import { useRemoteHosts } from "../stores/settingsStore";

/** "wss://mini.tailnet.ts.net" → "mini.tailnet.ts.net". */
function labelFromUrl(url: string): string {
  return url.replace(/^wss?:\/\//, "").split("/")[0] || "Host";
}

export function hostLinkState(
  connection: HostConnectionInfo | undefined,
  unreachable = false,
): HostLinkState {
  if (!connection) {
    return unreachable ? "failed" : "detached";
  }
  // A host that has already handed us a snapshot is coming back, not starting
  // up — worth saying, because its last snapshot is still onscreen.
  switch (connection.state) {
    case "ready":
      return "connected";
    case "offline":
      return connection.hydrated ? "reconnecting" : "failed";
    default:
      return connection.hydrated ? "reconnecting" : "connecting";
  }
}

export interface HostEntries {
  attach: (hostId: string) => void;
  busyId: string | null;
  detach: (hostId: string) => void;
  entries: HostConnectionEntry[];
  focus: (hostId: string) => void;
  /** The host the current view reads from. */
  focused: HostConnectionInfo | undefined;
}

export function useHostEntries(): HostEntries {
  const connections = useHostConnections();
  const paired = useRemoteHosts();
  const focusedId = useRouteHostId();
  const unreachable = useUnreachableHosts();
  const [busyId, setBusyId] = useState<string | null>(null);

  const byId = new Map(connections.map((c) => [c.hostId, c]));
  const local = byId.get(LOCAL_HOST_ID);

  const entries: HostConnectionEntry[] = [
    {
      id: LOCAL_HOST_ID,
      label: local?.label ?? "This Mac",
      local: true,
      attached: true,
      focused: focusedId === LOCAL_HOST_ID,
      state: "connected",
      detail: "Agents run in this app",
    },
    ...paired.map((host): HostConnectionEntry => {
      const connection = byId.get(host.id);

      return {
        id: host.id,
        label: host.label,
        attached: connection !== undefined,
        focused: focusedId === host.id,
        state: hostLinkState(connection, unreachable.includes(host.label)),
        detail: connection?.lastError ?? labelFromUrl(host.url),
      };
    }),
  ];

  const attach = useCallback((hostId: string) => {
    setBusyId(hostId);
    attachTo(hostId)
      .catch((err: unknown) =>
        pushError(
          err instanceof Error ? err.message : String(err),
          "attach_host",
        ),
      )
      .finally(() => setBusyId(null));
  }, []);

  const detach = useCallback((hostId: string) => {
    setBusyId(hostId);
    detachFrom(hostId)
      .catch(() => undefined)
      .finally(() => setBusyId(null));
  }, []);

  const focus = useCallback((hostId: string) => {
    focusHost(hostId).catch(() => undefined);
  }, []);

  return {
    entries,
    busyId,
    attach,
    detach,
    focus,
    focused: byId.get(focusedId),
  };
}
