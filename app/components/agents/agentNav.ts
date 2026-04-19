import { useProjects } from "../../hooks/useWorkspaces";
import { focusAgent } from "../../lib/agentLifecycle";
import { setActiveAgent } from "../../stores/agentStore";
import { setCenterView } from "../../stores/centerViewStore";
import { setActiveCenterView } from "../../stores/editorStore";
import { selectWorkspace } from "../../stores/workspaceStore";

type GotoKind = "agent" | "project" | "workspace";

/**
 * Navigation helpers for the Agents screen. Opens the owning project, selects
 * the workspace, and routes the center panel to the matching view.
 */
export function useAgentNavigation() {
  const { openProject } = useProjects();

  async function goto(
    target: { agentId?: string; repoRoot: string; workspaceId: string },
    kind: GotoKind,
  ): Promise<void> {
    await openProject(target.repoRoot, {
      autoSelect: kind === "project",
      skipRecent: true,
    });

    if (kind === "workspace") {
      setCenterView("home");
      selectWorkspace(target.workspaceId);
      setActiveAgent(target.workspaceId, null);
      setActiveCenterView("agents");
    }

    if (kind === "agent" && target.agentId) {
      setCenterView("home");
      focusAgent(target.workspaceId, target.agentId);
    }

    if (kind === "project") {
      setCenterView("home");
    }
  }

  return { goto };
}
