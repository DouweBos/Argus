/**
 * The two-pane split, derived from the URL: a master screen (the project list
 * or a project) and, when the URL names one, a detail screen beside it.
 */

import { repoOfSession } from "../routing/open";
import {
  HOME,
  paneFor,
  projectScreen,
  type Screen,
  sessionOfScreen,
} from "../routing/screens";
import { useProjectsStore } from "../stores/projects";

/** The master screen last on screen, for detail screens that belong to no project. */
let lastMaster: Screen = HOME;

const sessionOf = sessionOfScreen;

/**
 * What the master pane shows beside `screen`: itself when it is a master
 * screen; the project a session-scoped detail belongs to, once its sessions
 * are loaded; otherwise whatever was there before.
 */
export function useMasterScreen(screen: Screen): Screen {
  // Re-derive when a project's sessions arrive.
  useProjectsStore((s) => s.sessionsByRepo);
  if (paneFor(screen) === "master") {
    lastMaster = screen;

    return screen;
  }
  const sessionId = sessionOf(screen);
  const repoRoot = sessionId ? repoOfSession(sessionId) : null;

  return repoRoot ? projectScreen(repoRoot) : lastMaster;
}

/** Where Back goes when there is no in-app history (a deep link opened the tab). */
export function parentOf(screen: Screen): Screen {
  switch (screen.name) {
    case "device":
      return { name: "devices" };
    case "file":
    case "search":
      return { name: "files", sessionId: screen.sessionId };
    case "fileDiff":
      return { name: "changes", sessionId: screen.sessionId, mode: screen.mode };
    case "agent":
    case "session":
    case "changes":
    case "files":
    case "terminals": {
      const repoRoot = repoOfSession(screen.sessionId);

      return repoRoot ? projectScreen(repoRoot) : HOME;
    }
    default:
      return HOME;
  }
}
