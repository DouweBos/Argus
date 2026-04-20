import { useProjects } from "../../hooks/useSessions";
import { focusAgent } from "../../lib/agentLifecycle";
import { setActiveAgent } from "../../stores/agentStore";
import { setCenterView } from "../../stores/centerViewStore";
import { setActiveCenterView } from "../../stores/editorStore";
import { selectSession } from "../../stores/sessionStore";

type GotoKind = "agent" | "project" | "session";

/**
 * Navigation helpers for the Agents screen. Opens the owning project, selects
 * the session, and routes the center panel to the matching view.
 */
export function useAgentNavigation() {
  const { openProject } = useProjects();

  async function goto(
    target: { agentId?: string; repoRoot: string; sessionId: string },
    kind: GotoKind,
  ): Promise<void> {
    await openProject(target.repoRoot, {
      autoSelect: kind === "project",
      skipRecent: true,
    });

    if (kind === "session") {
      setCenterView("home");
      selectSession(target.sessionId);
      setActiveAgent(target.sessionId, null);
      setActiveCenterView("agents");
    }

    if (kind === "agent" && target.agentId) {
      setCenterView("home");
      focusAgent(target.sessionId, target.agentId);
    }

    if (kind === "project") {
      setCenterView("home");
    }
  }

  return { goto };
}
