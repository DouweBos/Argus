import type { AgentStatus, Session } from "../../../lib/types";
import { useMemo } from "react";
import { Badge, Eyebrow, Icons, StatusDot } from "@argus/peacock";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useConversations } from "../../../stores/conversationStore";
import { useSessions } from "../../../stores/sessionStore";
import { requestStopAgent } from "../../shared/ConfirmStopAgent/stopAgentGuard";
import styles from "./OrchestrationTree.module.css";

const MAX_TITLE_CHARS = 60;

function agentTitle(
  agentId: string,
  conversationTitle: string | undefined,
): string {
  const trimmed = conversationTitle?.trim();
  if (trimmed) {
    return trimmed.length > MAX_TITLE_CHARS
      ? trimmed.slice(0, MAX_TITLE_CHARS - 1) + "\u2026"
      : trimmed;
  }

  return `Agent ${agentId.slice(0, 6)}`;
}

interface OrchestrationTreeProps {
  /** Currently focused agent (highlighted in the tree). */
  activeAgentId: string | null;
  /** Called when the user clicks a child agent row. */
  onSelectAgent: (agentId: string, sessionId: string) => void;
  /** Called when the user changes the session filter dropdown. */
  onSessionFilterChange?: (sessionId: string) => void;
  /**
   * Restrict the view to agents whose session_id matches this value, or
   * `"all"` / undefined to show every agent. Children of a matching
   * orchestrator are always shown so the relationship stays visible even
   * if those children live in a different session.
   */
  sessionFilter?: string;
  /** Whether to show the session filter dropdown in the header. */
  showFilter?: boolean;
  /** Override the header title (defaults to "Agents"). */
  title?: string;
}

interface AgentNode {
  agent: AgentStatus;
  branch: string | null;
  children: AgentNode[];
  displayName: string | null;
  session: Session | null;
}

const STATUS_ORDER: Record<string, number> = {
  running: 0,
  idle: 1,
  stopped: 2,
  error: 3,
};

type PeacockAgentStatus = "done" | "error" | "idle" | "pending" | "running";

function statusTone(status: string): "error" | "idle" | "success" {
  if (status === "running") {
    return "success";
  }
  if (status === "error") {
    return "error";
  }

  return "idle";
}

function toPeacockStatus(status: string): PeacockAgentStatus {
  switch (status) {
    case "running":
      return "running";
    case "idle":
      return "idle";
    case "stopped":
      return "done";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

export function OrchestrationTree({
  activeAgentId,
  onSelectAgent,
  sessionFilter,
  onSessionFilterChange,
  showFilter = false,
  title = "Agents",
}: OrchestrationTreeProps) {
  const agents = useAgentsRecord();
  const sessions = useSessions();
  const conversations = useConversations();

  const activeFilter = sessionFilter ?? "all";

  const tree = useMemo(() => {
    const allAgents = Object.values(agents);
    if (allAgents.length === 0) {
      return [];
    }

    const wsMap = new Map(sessions.map((w) => [w.id, w]));

    function buildNode(agent: AgentStatus): AgentNode {
      const ws = wsMap.get(agent.session_id);
      const children = allAgents
        .filter((a) => a.parent_agent_id === agent.agent_id)
        .sort(
          (a, b) =>
            (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
        )
        .map(buildNode);

      return {
        agent,
        branch: ws?.branch ?? null,
        displayName: ws?.display_name ?? null,
        session: ws ?? null,
        children,
      };
    }

    // A root is any agent whose parent isn't in the store (orphaned or
    // user-initiated). We render orchestrators (those with children) first,
    // then standalone agents.
    const roots = allAgents.filter(
      (a) => !a.parent_agent_id || !agents[a.parent_agent_id],
    );

    const orchestrators = roots
      .filter((a) => allAgents.some((c) => c.parent_agent_id === a.agent_id))
      .sort(
        (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
      )
      .map(buildNode);

    const standalone = roots
      .filter((a) => !allAgents.some((c) => c.parent_agent_id === a.agent_id))
      .sort(
        (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
      )
      .map(buildNode);

    const combined = [...orchestrators, ...standalone];

    if (activeFilter === "all") {
      return combined;
    }

    // Keep any tree whose root or any descendant lives in the filtered
    // session — this way orchestrators stay visible when their children
    // span sessions.
    function matches(node: AgentNode): boolean {
      if (node.agent.session_id === activeFilter) {
        return true;
      }

      return node.children.some(matches);
    }

    return combined.filter(matches);
  }, [agents, sessions, activeFilter]);

  // Build the set of session IDs that actually have at least one agent, so
  // the dropdown only lists useful choices.
  const sessionsWithAgents = useMemo(() => {
    const ids = new Set(Object.values(agents).map((a) => a.session_id));

    return sessions.filter((w) => ids.has(w.id));
  }, [agents, sessions]);

  const allAgents = Object.values(agents);
  const visibleAgents = useMemo(() => {
    if (activeFilter === "all") {
      return allAgents;
    }

    return allAgents.filter((a) => a.session_id === activeFilter);
  }, [allAgents, activeFilter]);

  const counts = {
    running: visibleAgents.filter((a) => a.status === "running").length,
    idle: visibleAgents.filter((a) => a.status === "idle").length,
    stopped: visibleAgents.filter((a) => a.status === "stopped").length,
    error: visibleAgents.filter((a) => a.status === "error").length,
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Eyebrow count={visibleAgents.length}>{title}</Eyebrow>
        {showFilter && sessionsWithAgents.length > 0 && (
          <select
            aria-label="Filter by session"
            className={styles.filterSelect}
            value={activeFilter}
            onChange={(e) => onSessionFilterChange?.(e.target.value)}
          >
            <option value="all">All sessions</option>
            {sessionsWithAgents.map((w) => (
              <option key={w.id} value={w.id}>
                {w.display_name ?? w.branch ?? w.id.slice(0, 8)}
              </option>
            ))}
          </select>
        )}
      </div>

      {tree.length === 0 ? (
        <div className={styles.emptyState}>
          {allAgents.length === 0
            ? "No agents running."
            : "No agents in this session."}
        </div>
      ) : (
        groupNodesBySession(tree, sessions).map((group) => (
          <div key={group.key} className={styles.sessionGroup}>
            {group.showHeader && (
              <div className={styles.sessionGroupHeader}>
                <span className={styles.sessionGroupName}>{group.label}</span>
                <Badge tone="neutral">{group.nodes.length}</Badge>
              </div>
            )}
            {group.nodes.map((node) => (
              <AgentNodeRow
                key={node.agent.agent_id}
                activeAgentId={activeAgentId}
                conversations={conversations}
                depth={0}
                node={node}
                showSession={!group.showHeader}
                onSelect={onSelectAgent}
              />
            ))}
          </div>
        ))
      )}

      {(counts.running > 0 ||
        counts.idle > 0 ||
        counts.stopped > 0 ||
        counts.error > 0) && (
        <div className={styles.summary}>
          {counts.running > 0 && (
            <div className={styles.summaryItem}>
              <StatusDot tone="success" pulse />
              {counts.running} running
            </div>
          )}
          {counts.idle > 0 && (
            <div className={styles.summaryItem}>
              <StatusDot tone="idle" />
              {counts.idle} idle
            </div>
          )}
          {counts.stopped > 0 && (
            <div className={styles.summaryItem}>
              <StatusDot tone="idle" />
              {counts.stopped} done
            </div>
          )}
          {counts.error > 0 && (
            <div className={styles.summaryItem}>
              <StatusDot tone="error" />
              {counts.error} error
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface SessionGroup {
  key: string;
  label: string;
  nodes: AgentNode[];
  showHeader: boolean;
}

/**
 * Group root nodes by their session. A header is only rendered when there
 * are multiple distinct sessions in the list — otherwise we flatten the
 * output so a single-session view stays clean.
 */
function groupNodesBySession(
  nodes: AgentNode[],
  sessions: Session[],
): SessionGroup[] {
  const wsMap = new Map(sessions.map((w) => [w.id, w]));
  const groups = new Map<string, SessionGroup>();

  for (const node of nodes) {
    const wsId = node.agent.session_id;
    const ws = wsMap.get(wsId);
    const key = wsId || "__orphan";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label:
          ws?.display_name ??
          ws?.branch ??
          (wsId ? `${wsId.slice(0, 8)} (deleted)` : "No session"),
        nodes: [],
        showHeader: true,
      };
      groups.set(key, group);
    }
    group.nodes.push(node);
  }

  const list = Array.from(groups.values());
  // Hide the session header when every root belongs to the same session
  // — the header would be redundant in that case.
  if (list.length <= 1) {
    list.forEach((g) => {
      g.showHeader = false;
    });
  }

  return list;
}

function AgentNodeRow({
  node,
  depth,
  activeAgentId,
  conversations,
  showSession,
  onSelect,
}: {
  activeAgentId: string | null;
  conversations: Record<string, { title?: string }>;
  depth: number;
  node: AgentNode;
  onSelect: (agentId: string, sessionId: string) => void;
  showSession: boolean;
}) {
  const isActive = node.agent.agent_id === activeAgentId;
  const isOrchestrator = node.children.length > 0;
  const conv = conversations[node.agent.agent_id];
  const label = agentTitle(node.agent.agent_id, conv?.title);
  const sessionLabel =
    node.displayName ?? node.branch ?? node.agent.session_id.slice(0, 8);
  const isAlive =
    node.agent.status === "running" || node.agent.status === "idle";

  return (
    <>
      <div
        className={`${styles.agentRow} ${isActive ? styles.agentRowActive : ""} ${depth > 0 ? styles.childRow : ""}`}
        onClick={() => onSelect(node.agent.agent_id, node.agent.session_id)}
      >
        {depth > 0 && <span className={styles.connector} />}
        <StatusDot
          tone={statusTone(node.agent.status)}
          pulse={node.agent.status === "running"}
          title={node.agent.status}
        />
        <span className={styles.agentName}>{label}</span>
        {isOrchestrator && (
          <Badge tone="accent" size="pill" className={styles.orchestratorBadge}>
            orchestrator
          </Badge>
        )}
        {(showSession || depth > 0) && (
          <span className={styles.agentBranch} title={sessionLabel}>
            {sessionLabel}
          </span>
        )}
        <span className={styles.statusLabel}>
          {toPeacockStatus(node.agent.status)}
        </span>
        {isAlive && (
          <button
            className={styles.stopBtn}
            title="Stop agent"
            onClick={(e) => {
              e.stopPropagation();
              requestStopAgent(node.agent.agent_id);
            }}
          >
            <Icons.CloseIcon size={10} />
          </button>
        )}
      </div>
      {node.children.map((child) => (
        <AgentNodeRow
          key={child.agent.agent_id}
          activeAgentId={activeAgentId}
          conversations={conversations}
          depth={depth + 1}
          node={child}
          showSession={showSession}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
