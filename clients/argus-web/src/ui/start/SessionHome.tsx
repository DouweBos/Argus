/**
 * `/sessions/:id`: start an agent here or in a new worktree, the session's
 * agents, and its saved chats to search, resume, pin or delete.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  chatsInSession,
  describeError,
  sessionTitle,
  historyEntry,
  historyMatch,
} from "@argus/client-core";
import {
  AgentRow,
  Banner,
  ChatHistoryList,
  EmptyState,
  Icons,
  SectionPanel,
  Spinner,
  StartHeading,
} from "@argus/peacock";
import type { RemoteAgentStatus, RemoteSession } from "../../lib/protocol";
import { openAgent } from "../../routing/open";
import { appNavigate } from "../../routing/router";
import { useChatsStore } from "../../stores/chats";
import { useConnectionStore } from "../../stores/connection";
import { useProjectsStore } from "../../stores/projects";
import { capture } from "../../telemetry/telemetry";
import { agentAwaitingLabel, agentMetaLabel, mapAgentStatus } from "../agentStatus";
import { SessionDesignChips } from "../design/SessionDesignChips";
import { agentLabel } from "../screenTitle";
import { useLiveRefresh } from "../useLiveRefresh";
import { useHeldSession } from "./useHeldSession";
import { WebStartComposer } from "./WebStartComposer";

const NO_AGENTS: RemoteAgentStatus[] = [];

function SessionAgents({ agents }: { agents: RemoteAgentStatus[] }) {
  if (agents.length === 0) {
    return null;
  }

  return (
    <SectionPanel meta={`${agents.length}`} title="Agents">
      {agents.map((a) => (
        <AgentRow
          key={a.agent_id}
          meta={agentAwaitingLabel(a) ?? agentMetaLabel(a.status)}
          name={
            <span className="aw-inline">
              {a.pinned && <Icons.PinIcon size={10} />}
              {agentLabel(a.agent_id, a)}
            </span>
          }
          role="button"
          status={a.awaiting ? "pending" : mapAgentStatus(a.status)}
          tabIndex={0}
          onClick={() => openAgent(a)}
        />
      ))}
    </SectionPanel>
  );
}

function SessionChats({ session }: { session: RemoteSession }) {
  const connection = useConnectionStore((s) => s.connection);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const stopped = useChatsStore((s) => s.stoppedByRepo[session.repo_root]);
  const error = useChatsStore((s) => s.stoppedErrorByRepo[session.repo_root]);
  const { loadStopped, search, remove, setPinned, resume } = useChatsStore();
  const searched = useRef(false);

  useEffect(() => {
    if (connection === "ready") {
      void loadStopped(session.repo_root);
    }
  }, [connection, loadStopped, session.repo_root]);

  const chats = useMemo(
    () => chatsInSession(stopped ?? [], session),
    [stopped, session],
  );
  const entries = useMemo(
    () => chats.map((c) => historyEntry(c, session.id)),
    [chats, session.id],
  );
  const runSearch = useCallback(
    async (query: string) => {
      if (!searched.current) {
        searched.current = true;
        capture("web_chat_history_used", { action: "search" });
      }
      const results = await search(session.repo_root, query);
      const byId = new Map(entries.map((e) => [e.id, e]));

      return results.flatMap((r) => {
        const entry = byId.get(r.history_id);

        return entry
          ? [
              {
                entry,
                metaMatch: false,
                messageMatches: r.message_matches.map(historyMatch),
              },
            ]
          : [];
      });
    },
    [entries, search, session.repo_root],
  );

  return (
    <>
      {error && <Banner tone="warning">{error}</Banner>}
      <ChatHistoryList
        entries={entries}
        meta={`${entries.length} in this session`}
        search={runSearch}
        title="Recent chats"
        onDelete={(historyId) => {
          if (!hasControl || !window.confirm("Delete this chat for good?")) {
            return;
          }
          capture("web_chat_history_used", { action: "delete" });
          remove(session.repo_root, [historyId]).catch(() => {});
        }}
        onResume={(runnerSessionId) => {
          const chat = chats.find((c) => c.runner_session_id === runnerSessionId);
          if (chat && hasControl) {
            resume(chat, session.id)
              .then((agent) => openAgent(agent))
              .catch((err: unknown) => window.alert(describeError(err)));
          }
        }}
        onSetPinned={
          hasControl
            ? (historyId, pinned) => {
                setPinned(session.repo_root, historyId, pinned).catch(() => {});
              }
            : undefined
        }
        onView={(historyId) =>
          appNavigate({ name: "chat", sessionId: session.id, historyId })
        }
      />
    </>
  );
}

export function SessionHome({ sessionId }: { sessionId: string }) {
  const hasControl = useConnectionStore((s) => s.hasControl());
  const session = useHeldSession(sessionId);
  const repoRoot = session?.repo_root;
  const agents = useProjectsStore((s) =>
    repoRoot ? s.agentsByRepo[repoRoot] : undefined,
  );
  const sessions = useProjectsStore((s) =>
    repoRoot ? s.sessionsByRepo[repoRoot] : undefined,
  );
  const loadAgents = useProjectsStore((s) => s.loadAgents);
  const projects = useProjectsStore((s) => s.projects);
  const connection = useConnectionStore((s) => s.connection);

  // A worktree's first agent starts once its setup ends, with no event this tab follows.
  const refreshAgents = useCallback(() => {
    if (repoRoot) {
      loadAgents(repoRoot).catch(() => {});
    }
  }, [loadAgents, repoRoot]);
  useLiveRefresh(connection === "ready" && !!repoRoot, refreshAgents);

  const sessionAgents = useMemo(
    () =>
      (agents ?? NO_AGENTS)
        .filter((a) => a.session_id === sessionId && a.status !== "stopped")
        .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)),
    [agents, sessionId],
  );

  if (session === undefined) {
    return (
      <div className="aw-center">
        <Spinner />
        <span className="aw-muted">Finding the session…</span>
      </div>
    );
  }
  if (session === null) {
    return (
      <EmptyState
        icon={<Icons.BranchIcon size={22} />}
        title="Session not found"
        body="It may have been deleted on your computer."
      />
    );
  }
  const projectName = projects.find((p) => p.repo_root === session.repo_root)?.name;
  const projectRootBranch =
    sessions?.find((s) => s.kind === "project_root")?.branch ?? null;

  return (
    <div className="aw-session-home">
      {session.status === "initializing" && (
        <Banner tone="info">Setting up the worktree…</Banner>
      )}
      {session.status === "error" && session.setup_error && (
        <Banner tone="error">{session.setup_error}</Banner>
      )}
      <SessionDesignChips session={session} />
      {hasControl && session.status === "ready" && (
        <StartHeading
          project={projectName}
          subtitle={sessionTitle(session)}
        />
      )}
      {hasControl && session.status === "ready" && (
        <WebStartComposer
          key={session.id}
          projectRootBranch={projectRootBranch}
          session={session}
          onStarted={(started) =>
            started.kind === "agent"
              ? openAgent(started.agent)
              : appNavigate({
                  name: "sessionHome",
                  sessionId: started.session.id,
                })
          }
        />
      )}
      <SessionAgents agents={sessionAgents} />
      <SessionChats session={session} />
    </div>
  );
}
