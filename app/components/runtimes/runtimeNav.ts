import { useProjects } from "../../hooks/useSessions";
import { setCenterView } from "../../stores/centerViewStore";
import { setActiveTool } from "../../stores/layoutStore";
import { selectSession } from "../../stores/sessionStore";
import { setActiveSession } from "../../stores/terminalStore";

type GotoKind = "project" | "runtime" | "session";

export interface RuntimeTarget {
  repoRoot: string;
  sessionId: string;
  terminalId: string;
}

/**
 * Navigation helpers for the Runtimes screen. Opens the owning project, selects
 * the session, and routes the right-side tool panel to the matching terminal.
 */
export function useRuntimeNavigation() {
  const { openProject } = useProjects();

  async function goto(target: RuntimeTarget, kind: GotoKind): Promise<void> {
    await openProject(target.repoRoot, {
      autoSelect: kind === "project",
      skipRecent: true,
    });

    if (kind === "project") {
      setCenterView("home");

      return;
    }

    if (kind === "runtime") {
      setActiveSession(target.sessionId, target.terminalId);
      setActiveTool("terminal");
    }
    selectSession(target.sessionId);
  }

  return { goto };
}
