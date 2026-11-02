/**
 * The session at a glance, top right of its screens, as on the Mac: the
 * Agent / Code / Git switcher, then (unless folded) the computer it's on, the
 * agent's MCP servers and pin, its ticket and designs, its branch, pushing it,
 * how much it has changed, and its recent chats.
 */

import { useEffect, useState } from "react";
import {
  ContextCard,
  ContextCardDivider,
  ContextCardRow,
  ContextCardSegments,
  DiffStat,
  Icons,
  StatusDot,
} from "@argus/peacock";
import type { RemoteSession } from "../../lib/protocol";
import { openDesign } from "../../routing/open";
import { appNavigate } from "../../routing/router";
import type { Screen } from "../../routing/screens";
import { useAgentExtrasStore } from "../../stores/agentExtras";
import { useAgentsStore } from "../../stores/agents";
import { useChatsStore } from "../../stores/chats";
import { useConnectionStore } from "../../stores/connection";
import { useGitStore } from "../../stores/git";
import { pushWork } from "../../stores/land";
import { capture } from "../../telemetry/telemetry";
import { McpServersDialog } from "../McpServersDialog";
import { useLiveRefresh } from "../useLiveRefresh";

export type SessionPanel = "agent" | "code" | "git";

const CARD_KEY = "argus.web.contextCard.collapsed";

/** Agent opens with the card out; Code and Git keep it to its switcher. */
function readCollapsed(panel: SessionPanel): boolean {
  try {
    const raw = localStorage.getItem(`${CARD_KEY}.${panel}`);

    return raw === null ? panel !== "agent" : raw === "1";
  } catch {
    return panel !== "agent";
  }
}

function writeCollapsed(panel: SessionPanel, collapsed: boolean): void {
  try {
    localStorage.setItem(`${CARD_KEY}.${panel}`, collapsed ? "1" : "0");
  } catch {
    // storage unavailable: the choice lasts this visit
  }
}

export function panelOfScreen(screen: Screen): SessionPanel | null {
  switch (screen.name) {
    case "agent":
    case "session":
    case "sessionHome":
    case "chat":
      return "agent";
    case "files":
    case "file":
    case "search":
      return "code";
    case "changes":
    case "fileDiff":
    case "branches":
    case "branch":
    case "compare":
    case "stashes":
    case "commit":
      return "git";
    default:
      return null;
  }
}

export function SessionContextCard({
  agentId,
  panel,
  session,
}: {
  agentId: string | null;
  panel: SessionPanel;
  session: RemoteSession;
}) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(panel));
  useEffect(() => setCollapsed(readCollapsed(panel)), [panel]);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsed(panel, next);
    capture("web_context_card_used", { action: next ? "collapse" : "expand" });
  };
  const pick = (next: SessionPanel) => {
    capture("web_context_card_used", { action: next });
    appNavigate(
      next === "agent"
        ? { name: "session", sessionId: session.id }
        : next === "code"
          ? { name: "files", sessionId: session.id }
          : { name: "changes", sessionId: session.id, mode: "branch" },
    );
  };

  return (
    <ContextCard collapsed={collapsed}>
      <ContextCardSegments<SessionPanel>
        collapsed={collapsed}
        segments={[
          { id: "agent", title: "Agent", icon: <Icons.SparklesIcon size={12} /> },
          { id: "code", title: "Code", icon: <Icons.CodeIcon size={12} /> },
          { id: "git", title: "Git", icon: <Icons.BranchIcon size={12} /> },
        ]}
        selected={panel}
        onSelect={pick}
        onToggleCollapsed={toggle}
      />
      {!collapsed && <CardDetails agentId={agentId} session={session} />}
    </ContextCard>
  );
}

function CardDetails({
  agentId,
  session,
}: {
  agentId: string | null;
  session: RemoteSession;
}) {
  const account = useConnectionStore((s) => s.identity?.account);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const connection = useConnectionStore((s) => s.connection);
  const git = useGitStore((s) => s.gitStatusBySession[session.id]);
  const loadGitStatus = useGitStore((s) => s.loadGitStatus);
  const ready = session.status === "ready" && session.availability !== "unavailable";
  const outside = session.kind === "scratch_pad" || session.kind === "automation_host";
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [showingMcp, setShowingMcp] = useState(false);
  useLiveRefresh(connection === "ready" && ready && !outside, () => {
    loadGitStatus(session.id).catch(() => {});
  }, 10_000);

  const ahead = git?.ahead ?? 0;
  const additions = git?.diff_additions ?? 0;
  const deletions = git?.diff_deletions ?? 0;
  const branch = git?.branch ?? session.branch;
  const track = (action: "branch" | "changes" | "design" | "linked_issue" | "push" | "recent_chats") =>
    capture("web_context_card_used", { action });

  return (
    <>
      <ContextCardDivider />
      <ContextCardRow
        icon={<Icons.LaptopIcon size={13} />}
        label={account?.hostName ?? "Paired computer"}
        title="Connection"
        onClick={() => appNavigate({ name: "settingsPage", page: "connection" })}
        trailing={<StatusDot tone={connection === "ready" ? "success" : "warning"} />}
      />
      {agentId && <AgentRows agentId={agentId} onMcp={() => setShowingMcp(true)} />}
      {!outside && (
        <>
          <ContextCardDivider />
          {session.linked_issue && (
            <ContextCardRow
              icon={<Icons.LinearIcon size={12} />}
              label={`${session.linked_issue.identifier} ${session.linked_issue.title}`}
              onClick={() => {
                track("linked_issue");
                appNavigate({
                  name: "issues",
                  scope: "assigned",
                  query: null,
                  issueRef: session.linked_issue?.identifier ?? null,
                });
              }}
            />
          )}
          {(session.design_refs ?? []).map((design) => (
            <ContextCardRow
              key={design.url}
              icon={<Icons.FigmaIcon size={12} />}
              label={design.name}
              onClick={() => {
                track("design");
                openDesign(design.url, { sessionId: session.id, source: "session" });
              }}
            />
          ))}
          <ContextCardRow
            icon={<Icons.BranchIcon size={12} />}
            label={branch}
            title={session.base_branch ? `${branch} from ${session.base_branch}` : branch}
            onClick={() => {
              track("branch");
              appNavigate({ name: "branches", sessionId: session.id });
            }}
          />
          {ready && hasControl && (
            <ContextCardRow
              disabled={pushing}
              icon={<Icons.PushIcon size={12} />}
              label={pushing ? "Pushing…" : (pushError ?? "Push")}
              muted={ahead === 0}
              title={
                git?.upstream
                  ? ahead > 0
                    ? `Push ${ahead} commit${ahead === 1 ? "" : "s"} to ${git.upstream}`
                    : `Up to date with ${git.upstream}`
                  : "Publish the branch"
              }
              trailing={ahead > 0 ? `↑${ahead}` : undefined}
              onClick={() => {
                track("push");
                setPushing(true);
                setPushError(null);
                pushWork(session.id)
                  .catch(() => setPushError("Push failed"))
                  .finally(() => setPushing(false));
              }}
            />
          )}
          {ready && (
            <ContextCardRow
              icon={<Icons.FileIcon size={12} />}
              label="Changes"
              trailing={
                additions + deletions > 0 ? (
                  <DiffStat added={additions} removed={deletions} />
                ) : git && git.dirty_count > 0 ? (
                  git.dirty_count
                ) : undefined
              }
              onClick={() => {
                track("changes");
                appNavigate({ name: "changes", sessionId: session.id, mode: "working" });
              }}
            />
          )}
        </>
      )}
      <ContextCardDivider />
      <RecentChatsRow session={session} onOpen={() => track("recent_chats")} />
      {showingMcp && agentId && (
        <McpServersDialog agentId={agentId} onClose={() => setShowingMcp(false)} />
      )}
    </>
  );
}

/** MCP n/m and the pin, for the agent in front. */
function AgentRows({ agentId, onMcp }: { agentId: string; onMcp: () => void }) {
  const mcp = useAgentExtrasStore((s) => s.mcpByAgent[agentId]);
  const loadMcp = useAgentExtrasStore((s) => s.loadMcp);
  const status = useAgentsStore((s) => s.statusByAgent[agentId]);
  const setPinned = useAgentsStore((s) => s.setPinned);
  const hasControl = useConnectionStore((s) => s.hasControl());
  useEffect(() => {
    void loadMcp(agentId).catch(() => {});
  }, [agentId, loadMcp]);
  const servers = mcp?.servers ?? null;
  const connected = servers?.filter((s) => s.status === "connected").length ?? 0;
  const failing = servers ? servers.length - connected : 0;
  const pinned = status?.pinned === true;
  const canPin =
    hasControl && status && (pinned || (status.status !== "stopped" && status.status !== "error"));

  return (
    <>
      <ContextCardRow
        icon={<Icons.SlidersIcon size={12} />}
        label="MCP"
        trailing={
          servers && servers.length > 0 ? (
            <>
              {failing > 0 && <StatusDot tone="warning" />}
              {connected}/{servers.length}
            </>
          ) : undefined
        }
        onClick={onMcp}
      />
      {canPin && (
        <ContextCardRow
          icon={<Icons.PinIcon size={12} />}
          label={pinned ? "Pinned" : "Pin Chat"}
          muted={!pinned}
          title={
            pinned
              ? "Unpin: stop resuming it when the computer restarts"
              : "Pin: resume it when the computer restarts"
          }
          onClick={() => {
            setPinned(agentId, !pinned).catch(() => {});
          }}
        />
      )}
    </>
  );
}

function RecentChatsRow({
  session,
  onOpen,
}: {
  session: RemoteSession;
  onOpen: () => void;
}) {
  const chats = useChatsStore((s) => s.stoppedByRepo[session.repo_root]);
  const loadStopped = useChatsStore((s) => s.loadStopped);
  useEffect(() => {
    if (chats === undefined) {
      loadStopped(session.repo_root).catch(() => {});
    }
  }, [chats, loadStopped, session.repo_root]);
  const count = chats?.filter((c) => c.branch === session.branch).length ?? 0;

  return (
    <ContextCardRow
      icon={<Icons.HistoryIcon size={12} />}
      label="Recent Chats"
      muted={count === 0}
      title="Read and resume this session's past chats"
      trailing={count > 0 ? count : undefined}
      onClick={() => {
        onOpen();
        appNavigate({ name: "sessionHome", sessionId: session.id });
      }}
    />
  );
}
