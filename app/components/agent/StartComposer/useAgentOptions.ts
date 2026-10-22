import type { CanonicalPermissionMode } from "../../../lib/permissionModes";
import type { RunnerSelection } from "../ModelPicker";
import { useCallback, useMemo, useState } from "react";
import { setAgentRunner } from "../../../lib/ipc";
import { getLastKnownCapabilities } from "../../../lib/lastKnownCapabilities";
import { refreshPrewarm } from "../../../lib/prewarmService";
import { pushError } from "../../../stores/notificationsStore";
import { usePrewarmSlot } from "../../../stores/prewarmStore";
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

  // Prefer capabilities from the session's prewarmed subprocess — those match
  // the CLI the agent will claim. Fall back to whatever the most recent
  // conversation reported while prewarm is still spawning or has failed.
  const prewarmSlot = usePrewarmSlot(sessionId);
  const cached = useMemo(() => getLastKnownCapabilities(), []);
  const slashCommands = prewarmSlot?.slashCommands.length
    ? prewarmSlot.slashCommands
    : cached.slashCommands;

  const session = useSessions().find((s) => s.id === sessionId) ?? null;
  const registeredRunners = useRegisteredRunners();
  const [runnerId, setRunnerId] = useState(
    session?.runner_id ?? DEFAULT_LLM_RUNNER,
  );
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
      // Re-bind the warm subprocess now so starting is still instant; it ran
      // under the old runner's env.
      const warmAgentId = prewarmSlot?.agentId;
      if (warmAgentId) {
        setAgentRunner(warmAgentId, id)
          .then(() => refreshPrewarm(sessionId))
          .catch((err) => pushError(String(err), "set_agent_runner"));
      }
    },
  };

  // A custom runner declares its own models; the CLI handshake only knows the
  // base runner's, which the gateway it's pointed at won't accept.
  const models = useMemo(() => {
    const declared = registeredRunners.find((r) => r.id === runnerId)?.models;
    if (declared?.length) {
      return declared;
    }

    return prewarmSlot?.models.length ? prewarmSlot.models : cached.models;
  }, [registeredRunners, runnerId, prewarmSlot, cached.models]);

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
