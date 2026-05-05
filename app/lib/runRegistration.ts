import { setActiveToolForSession } from "../stores/layoutStore";
import {
  addSession,
  clearBuffer,
  clearRunningTerminalIfMatches,
  getSessionsForSession,
  replaceSessionId,
  setActiveSession,
  setRunningTerminal,
} from "../stores/terminalStore";
import { startListening, stopListening } from "./terminalBufferService";

export interface RunRegistrationDependency {
  sessionId: string;
  title: string;
}

export interface RunRegistrationInput {
  dependencies: RunRegistrationDependency[];
  /** Session id of the worktree the run was triggered for. */
  sessionId: string;
  /** Terminal session id of the freshly-spawned PTY for the primary command. */
  terminalSessionId: string;
  /** Run-command title from `.argus.json`. */
  title: string;
}

/**
 * Wire a freshly spawned run terminal into the renderer state: register the
 * terminal tab(s), start the buffer listener, mark the run as running, focus
 * the new tab, and open the bottom terminal panel for the targeted session.
 *
 * Shared between the user-pressed "Run" button (RunControl) and background
 * triggers (MCP `trigger_run`) so both produce the same visible result.
 */
export function registerRunTerminal({
  sessionId,
  title,
  terminalSessionId,
  dependencies,
}: RunRegistrationInput): void {
  for (const dep of dependencies) {
    setRunningTerminal(sessionId, dep.title, dep.sessionId);
    const depSessions = getSessionsForSession(sessionId);
    if (!depSessions.some((s) => s.id === dep.sessionId)) {
      addSession({
        id: dep.sessionId,
        session_id: sessionId,
        title: dep.title,
      });
    }
    startListening(dep.sessionId);
    const depTitle = dep.title;
    const depId = dep.sessionId;
    const unlistenDep = window.argus.on<number>(
      `terminal:exit:${depId}`,
      () => {
        clearRunningTerminalIfMatches(sessionId, depTitle, depId);
        unlistenDep();
        stopListening(depId);
      },
    );
  }

  setRunningTerminal(sessionId, title, terminalSessionId);

  // Reuse the tab from a previous run of the same title: swap the old (stale)
  // terminal id in place with the freshly spawned one, keeping the tab and
  // its position intact.
  const sessions = getSessionsForSession(sessionId);
  const sameTitle = sessions.find(
    (s) => s.title === title && s.id !== terminalSessionId,
  );
  if (sameTitle) {
    stopListening(sameTitle.id);
    clearBuffer(sameTitle.id);
    replaceSessionId(sessionId, sameTitle.id, terminalSessionId);
  } else if (!sessions.some((s) => s.id === terminalSessionId)) {
    addSession({
      id: terminalSessionId,
      session_id: sessionId,
      title,
    });
  }
  startListening(terminalSessionId);
  setActiveSession(sessionId, terminalSessionId);
  setActiveToolForSession(sessionId, "terminal");

  const unlisten = window.argus.on<number>(
    `terminal:exit:${terminalSessionId}`,
    () => {
      clearRunningTerminalIfMatches(sessionId, title, terminalSessionId);
      unlisten();
      stopListening(terminalSessionId);
    },
  );
}
