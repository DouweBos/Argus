import type { DeviceInfo } from "../../lib/types";
import { useProjects } from "../../hooks/useSessions";
import { addAgent, getAgent, setActiveAgent } from "../../stores/agentStore";
import { setCenterView } from "../../stores/centerViewStore";
import { setActiveCenterView } from "../../stores/editorStore";
import { getSessionState, selectSession } from "../../stores/sessionStore";

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").replace(/\/+/g, "/");
}

/**
 * Resolve the frontend session id for a device — the backend's id may have
 * been remapped when the project was first merged into the frontend store, so
 * we match by absolute path instead of id when available.
 */
function resolveFrontendSessionId(device: DeviceInfo): string | null {
  if (!device.sessionId) {
    return null;
  }
  if (!device.sessionPath) {
    return device.sessionId;
  }
  const target = normalizePath(device.sessionPath);
  const match = getSessionState().sessions.find(
    (w) => normalizePath(w.path) === target,
  );

  return match?.id ?? device.sessionId;
}

type GotoKind = "agent" | "project" | "session";

/**
 * Navigation helpers for the Devices screen and DeviceDialog. Keeps the
 * routing logic (project loading, store updates, id resolution) in one place.
 */
export function useDeviceNavigation() {
  const { openProject } = useProjects();

  async function goto(device: DeviceInfo, kind: GotoKind): Promise<void> {
    if (!device.repoRoot) {
      return;
    }
    await openProject(device.repoRoot, {
      autoSelect: kind === "project",
      skipRecent: true,
    });

    const wsId = resolveFrontendSessionId(device);

    if (kind === "session" && wsId) {
      setCenterView("home");
      selectSession(wsId);
      setActiveAgent(wsId, null);
      setActiveCenterView("agents");
    }

    if (kind === "agent" && wsId && device.agentId) {
      // Make sure the agent exists in the frontend store; otherwise
      // `setActiveAgent` would point at an id the AgentView can't render.
      if (!getAgent(device.agentId)) {
        addAgent({
          agent_id: device.agentId,
          session_id: wsId,
          status: "running",
        });
      }
      setCenterView("home");
      selectSession(wsId);
      setActiveAgent(wsId, device.agentId);
      setActiveCenterView("agents");
    }

    if (kind === "project") {
      setCenterView("home");
    }
  }

  return { goto };
}
