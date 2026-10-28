import type { LinearIssue } from "../lib/types";
import { useEffect } from "react";
import { create } from "zustand";
import { useIpcEvent } from "../hooks/useIpcEvent";
import { listIntegrations, listLinearIssues } from "../lib/ipc";

const POLL_MS = 5 * 60 * 1000;
const LIMIT = 100;

interface LinearIssuesState {
  /** Linear is connected and its credential still works. */
  connected: boolean;
  /** Null until the first fetch lands. */
  data: LinearIssue[] | null;
  error: string | null;
  loading: boolean;
}

const store = create<LinearIssuesState>(() => ({
  connected: false,
  data: null,
  error: null,
  loading: false,
}));

let inFlight: Promise<void> | null = null;

export function refreshLinearIssues(): Promise<void> {
  if (inFlight) {
    return inFlight;
  }
  store.setState({ loading: true });
  inFlight = listLinearIssues(null, LIMIT)
    .then((data) => store.setState({ data, error: null }))
    .catch((err: unknown) =>
      store.setState({
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    .finally(() => {
      store.setState({ loading: false });
      inFlight = null;
    });

  return inFlight;
}

async function refreshConnection(): Promise<void> {
  const all = await listIntegrations().catch(() => []);
  const connected = all.some(
    (s) => s.id === "linear" && s.connected && !s.needsReauth,
  );
  store.setState(
    connected ? { connected } : { connected, data: null, error: null },
  );
  if (connected) {
    await refreshLinearIssues();
  }
}

/** Keeps the assigned-issue list fresh while Linear is connected. Mount once. */
export function useLinearIssuesSync(): void {
  useEffect(() => {
    refreshConnection().catch(() => undefined);
    const timer = setInterval(() => {
      if (store.getState().connected) {
        refreshLinearIssues().catch(() => undefined);
      }
    }, POLL_MS);

    return () => clearInterval(timer);
  }, []);
  useIpcEvent("integration_status_changed", () => {
    refreshConnection().catch(() => undefined);
  });
}

export const useLinearIssues = () => store();
