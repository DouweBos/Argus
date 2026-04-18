import type { DeviceInfo } from "../../lib/types";
import { useProjects } from "../../hooks/useWorkspaces";
import { addAgent, getAgent, setActiveAgent } from "../../stores/agentStore";
import { setCenterView } from "../../stores/centerViewStore";
import { setActiveCenterView } from "../../stores/editorStore";
import {
  getWorkspaceState,
  selectWorkspace,
} from "../../stores/workspaceStore";

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").replace(/\/+/g, "/");
}

/**
 * Resolve the frontend workspace id for a device — the backend's id may have
 * been remapped when the project was first merged into the frontend store, so
 * we match by absolute path instead of id when available.
 */
function resolveFrontendWorkspaceId(device: DeviceInfo): string | null {
  if (!device.workspaceId) {
    return null;
  }
  if (!device.workspacePath) {
    return device.workspaceId;
  }
  const target = normalizePath(device.workspacePath);
  const match = getWorkspaceState().workspaces.find(
    (w) => normalizePath(w.path) === target,
  );

  return match?.id ?? device.workspaceId;
}

type GotoKind = "agent" | "project" | "workspace";

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

    const wsId = resolveFrontendWorkspaceId(device);

    if (kind === "workspace" && wsId) {
      setCenterView("home");
      selectWorkspace(wsId);
      setActiveCenterView("home");
    }

    if (kind === "agent" && wsId && device.agentId) {
      // Make sure the agent exists in the frontend store; otherwise
      // `setActiveAgent` would point at an id the AgentView can't render.
      if (!getAgent(device.agentId)) {
        addAgent({
          agent_id: device.agentId,
          workspace_id: wsId,
          status: "running",
        });
      }
      setCenterView("home");
      selectWorkspace(wsId);
      setActiveAgent(wsId, device.agentId);
      setActiveCenterView("agents");
    }

    if (kind === "project") {
      setCenterView("home");
    }
  }

  return { goto };
}
