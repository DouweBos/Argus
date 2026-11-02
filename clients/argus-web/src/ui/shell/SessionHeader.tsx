/**
 * The strip along the top of a session's screens: its agents as tabs (on the
 * agent screens) and the context card at the far end, as on the Mac.
 */

import { AgentTabStrip, type AgentTab } from "@argus/peacock";
import type { RemoteAgentStatus, RemoteSession } from "../../lib/protocol";
import { appNavigate } from "../../routing/router";
import type { Screen } from "../../routing/screens";
import { useConnectionStore } from "../../stores/connection";
import { useProjectsStore } from "../../stores/projects";
import { agentLabel } from "../screenTitle";
import { panelOfScreen, SessionContextCard } from "./SessionContextCard";

/** Every session the stores know, by id. */
export function useSession(sessionId: string | null): RemoteSession | null {
  return useProjectsStore((s) => {
    if (!sessionId) {
      return null;
    }
    for (const sessions of Object.values(s.sessionsByRepo)) {
      const found = sessions.find((x) => x.id === sessionId);
      if (found) {
        return found;
      }
    }

    return null;
  });
}

const NO_AGENTS: RemoteAgentStatus[] = [];

export function useSessionAgents(session: RemoteSession | null): RemoteAgentStatus[] {
  const all = useProjectsStore((s) =>
    session ? s.agentsByRepo[session.repo_root] : undefined,
  );
  if (!session || !all) {
    return NO_AGENTS;
  }

  return all.filter((a) => a.session_id === session.id && !a.parent_agent_id);
}

function tabOf(agent: RemoteAgentStatus): AgentTab {
  const status =
    agent.awaiting || agent.status === "requires_action"
      ? "warning"
      : agent.status === "running"
        ? "accent"
        : agent.status === "error"
          ? "error"
          : "idle";

  return {
    id: agent.agent_id,
    title: agentLabel(agent.agent_id, agent),
    status,
    busy: agent.status === "running",
  };
}

export function SessionHeader({
  screen,
  sessionId,
}: {
  screen: Screen;
  sessionId: string;
}) {
  const session = useSession(sessionId);
  const agents = useSessionAgents(session);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const panel = panelOfScreen(screen);
  const agentId = screen.name === "agent" ? screen.agentId : null;
  const showsTabs = panel === "agent";
  const card = session && panel && (
    <div className="aw-session-card">
      <SessionContextCard agentId={agentId} panel={panel} session={session} />
    </div>
  );

  return (
    <div className="aw-session-header">
      {showsTabs ? (
        <AgentTabStrip
          canStart={hasControl && session?.status === "ready"}
          selectedId={agentId}
          tabs={agents.map(tabOf)}
          onNew={
            hasControl
              ? () => appNavigate({ name: "sessionHome", sessionId })
              : undefined
          }
          onSelect={(id) =>
            appNavigate({ name: "agent", sessionId, agentId: id })
          }
        />
      ) : (
        <div className="aw-session-header-spacer" />
      )}
      {card}
    </div>
  );
}
