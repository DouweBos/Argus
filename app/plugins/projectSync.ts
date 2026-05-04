/**
 * Bridges the active session's `ArgusConfig.plugins.disabled` list into the
 * plugin store's project mask. Mounted once at the app shell level.
 */

import { useEffect, useMemo } from "react";
import { useArgusConfigVersion } from "../hooks/useArgusConfigVersion";
import { readArgusConfig } from "../lib/ipc";
import { useSelectedSessionId, useSessions } from "../stores/sessionStore";
import { setProjectDisabled } from "./store";
import { PLUGIN_IDS, type PluginId } from "./types";

const KNOWN = new Set<string>(PLUGIN_IDS);

export function usePluginProjectMaskSync(): void {
  const sessions = useSessions();
  const sessionId = useSelectedSessionId();
  const session = useMemo(
    () =>
      sessionId ? (sessions.find((s) => s.id === sessionId) ?? null) : null,
    [sessionId, sessions],
  );
  const repoRoot = session?.repo_root ?? null;
  const configVersion = useArgusConfigVersion(repoRoot);

  useEffect(() => {
    if (!repoRoot) {
      setProjectDisabled([]);

      return;
    }
    let cancelled = false;
    readArgusConfig(repoRoot)
      .then((cfg) => {
        if (cancelled) {
          return;
        }
        const disabled = (cfg.plugins?.disabled ?? []).filter(
          (id: string): id is PluginId => KNOWN.has(id),
        );
        setProjectDisabled(disabled);
      })
      .catch(() => {
        // Best-effort. Leave the prior mask in place.
      });

    return () => {
      cancelled = true;
    };
  }, [repoRoot, configVersion]);
}
