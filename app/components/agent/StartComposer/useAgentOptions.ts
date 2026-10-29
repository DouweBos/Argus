import type { CanonicalPermissionMode } from "../../../lib/permissionModes";
import type { StartOptions } from "../../../lib/types";
import type { RunnerSelection } from "../ModelPicker";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getStartOptions } from "../../../lib/ipc";
import { getLastKnownCapabilities } from "../../../lib/lastKnownCapabilities";
import { setComposerRunner } from "../../../lib/viewingHint";
import { useRegisteredRunners } from "../../../stores/runnersStore";
import { useSessions } from "../../../stores/sessionStore";
import {
  DEFAULT_LLM_RUNNER,
  getDefaultModel,
  getDefaultPermissionMode,
} from "../../../stores/settingsStore";

/**
 * The first agent's mode, runner, model and linked projects. The agent doesn't
 * exist yet, so every pick is local until it starts — it binds that agent
 * alone, never the session or its siblings.
 */
export function useAgentOptions(sessionId: string) {
  const [permissionMode, setPermissionMode] = useState<CanonicalPermissionMode>(
    getDefaultPermissionMode,
  );
  const [model, setModel] = useState(() => getDefaultModel() || "default");
  const [linkedProjects, setLinkedProjects] = useState<string[]>([]);

  const session = useSessions().find((s) => s.id === sessionId) ?? null;
  const registeredRunners = useRegisteredRunners();
  const sessionRunnerId = session?.runner_id ?? DEFAULT_LLM_RUNNER;
  const [runnerId, setRunnerId] = useState(sessionRunnerId);

  // The host answers from the CLI the start will take, else what that runner
  // last reported; the local cache covers the round trip.
  const [startOptions, setStartOptions] = useState<StartOptions | null>(null);
  useEffect(() => {
    let live = true;
    getStartOptions(sessionId, runnerId)
      .then((options) => live && setStartOptions(options))
      .catch(() => {});

    return () => {
      live = false;
    };
  }, [sessionId, runnerId]);
  const cached = useMemo(() => getLastKnownCapabilities(), []);
  const slashCommands = startOptions?.slashCommands.length
    ? startOptions.slashCommands
    : cached.slashCommands;

  // Warm the session's spare under the picked runner; the pick dies with the composer.
  useEffect(() => {
    setComposerRunner(
      sessionId,
      runnerId === sessionRunnerId ? null : runnerId,
    );
  }, [sessionId, runnerId, sessionRunnerId]);
  useEffect(() => () => setComposerRunner(sessionId, null), [sessionId]);

  const runner: RunnerSelection = {
    currentId: runnerId,
    locked: false,
    available: registeredRunners,
    onSelect: (id) => {
      if (id === runnerId) {
        return;
      }
      const next = registeredRunners.find((r) => r.id === id);
      // Models don't carry across runners — a gateway rejects the other
      // runner's ids, so reset to the newly picked runner's default.
      setModel(next?.defaultModel ?? next?.models?.[0]?.value ?? "default");
      setRunnerId(id);
    },
  };

  // A custom runner declares its own models; the CLI handshake only knows the
  // base runner's, which the gateway it's pointed at won't accept.
  const models = useMemo(() => {
    const declared = registeredRunners.find((r) => r.id === runnerId)?.models;
    if (declared?.length) {
      return declared;
    }

    return startOptions?.models.length
      ? startOptions.models.map((m) => ({
          value: m.value,
          displayName: m.displayName,
          description: m.description,
        }))
      : cached.models;
  }, [registeredRunners, runnerId, startOptions, cached.models]);

  const toggleLinkedProject = useCallback((path: string) => {
    setLinkedProjects((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    );
  }, []);

  return {
    linkedProjects,
    model,
    models,
    permissionMode,
    runner,
    runnerId,
    handleModelChange: setModel,
    handlePermissionModeChange: setPermissionMode,
    handleToggleLinkedProject: toggleLinkedProject,
    slashCommands,
  };
}
