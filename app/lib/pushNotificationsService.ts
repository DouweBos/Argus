/**
 * Handle clicks on native OS notifications fired by agents via the MCP
 * `push_notification` tool. The main process focuses the window itself; this
 * listener navigates the UI to the agent that triggered the notification so
 * the user lands directly in the right tab.
 */

import { setActiveAgent } from "../stores/agentStore";
import { selectSession } from "../stores/sessionStore";
import { listen } from "./events";

interface AgentNotificationClickedEvent {
  agent_id: string;
  session_id: string;
}

let initialized = false;

export function initPushNotificationsListener(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  listen<AgentNotificationClickedEvent>(
    "agent_notification_clicked",
    ({ payload }) => {
      selectSession(payload.session_id);
      setActiveAgent(payload.session_id, payload.agent_id);
    },
  );
}
