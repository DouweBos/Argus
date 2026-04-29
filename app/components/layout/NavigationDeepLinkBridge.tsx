import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts";
import { useIpcEvent } from "../../hooks/useIpcEvent";
import { getAgentState, setActiveAgent } from "../../stores/agentStore";

/**
 * Wires navigation-related side effects inside the Router context:
 *   - back/forward keyboard shortcuts (Cmd+[ / Cmd+])
 *   - mouse back/forward buttons (browser default)
 *   - `navigation:goto` IPC events from the main process (deep links)
 */
export function NavigationDeepLinkBridge() {
  const navigate = useNavigate();

  useGlobalShortcuts([
    {
      key: "[",
      meta: true,
      handler: () => navigate(-1),
    },
    {
      key: "]",
      meta: true,
      handler: () => navigate(1),
    },
  ]);

  useIpcEvent<{ agentId?: string; path: string }>(
    "navigation:goto",
    ({ path, agentId }) => {
      if (path) {
        navigate(path);
      }
      // When the deep link targets a specific agent, also set the session's
      // active agent. This is needed when the user is already on the target
      // session — react-router's navigate() to the same URL is a no-op, so
      // without this the click on a tray agent entry would do nothing.
      if (agentId) {
        const agent = getAgentState().agents[agentId];
        if (agent) {
          setActiveAgent(agent.session_id, agentId);
        }
      }
    },
  );

  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        navigate(-1);
      } else if (e.button === 4) {
        e.preventDefault();
        navigate(1);
      }
    };
    window.addEventListener("mouseup", onMouse);

    return () => window.removeEventListener("mouseup", onMouse);
  }, [navigate]);

  return null;
}
