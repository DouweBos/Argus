import { useMemo } from "react";
import type { AgentStatus } from "../../../lib/types";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useWorkspaces } from "../../../stores/workspaceStore";
import styles from "./OrchestrationTree.module.css";

interface OrchestrationTreeProps {
  /** Currently focused agent (highlighted in the tree). */
  activeAgentId: string | null;
  /** Called when the user clicks a child agent row. */
  onSelectAgent: (agentId: string, workspaceId: string) => void;
}

interface AgentNode {
  agent: AgentStatus;
  branch: string | null;
  children: AgentNode[];
  displayName: string | null;
}

const STATUS_ORDER: Record<string, number> = {
  running: 0,
  idle: 1,
  stopped: 2,
  error: 3,
};

function statusClass(status: string): string {
  switch (status) {
    case "running":
      return styles.statusRunning;
    case "idle":
      return styles.statusIdle;
    case "stopped":
      return styles.statusStopped;
    case "error":
      return styles.statusError;
    default:
      return styles.statusStopped;
  }
}

export function OrchestrationTree({
  activeAgentId,
  onSelectAgent,
}: OrchestrationTreeProps) {
  const agents = useAgentsRecord();
  const workspaces = useWorkspaces();

  const tree = useMemo(() => {
    const allAgents = Object.values(agents);
    if (allAgents.length === 0) return [];

    const wsMap = new Map(workspaces.map((w) => [w.id, w]));
    const childIds = new Set(
      allAgents
        .filter((a) => a.parent_agent_id)
        .map((a) => a.agent_id),
    );

    const roots = allAgents.filter(
      (a) => !a.parent_agent_id || !agents[a.parent_agent_id],
    );

    function buildNode(agent: AgentStatus): AgentNode {
      const ws = wsMap.get(agent.workspace_id);
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
        children,
      };
    }

    const orchestrators = roots
      .filter((a) => childIds.has(a.agent_id) || allAgents.some((c) => c.parent_agent_id === a.agent_id))
      .sort(
        (a, b) =>
          (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
      )
      .map(buildNode);

    const standalone = roots
      .filter((a) => !allAgents.some((c) => c.parent_agent_id === a.agent_id))
      .sort(
        (a, b) =>
          (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
      )
      .map(buildNode);

    return [...orchestrators, ...standalone];
  }, [agents, workspaces]);

  const allAgents = Object.values(agents);

  if (tree.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>No agents running.</div>
      </div>
    );
  }

  const counts = {
    running: allAgents.filter((a) => a.status === "running").length,
    idle: allAgents.filter((a) => a.status === "idle").length,
    stopped: allAgents.filter((a) => a.status === "stopped").length,
    error: allAgents.filter((a) => a.status === "error").length,
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Agents</span>
        <span className={styles.headerCount}>
          {allAgents.length} total
        </span>
      </div>

      {tree.map((node) => (
        <AgentNodeRow
          key={node.agent.agent_id}
          activeAgentId={activeAgentId}
          depth={0}
          node={node}
          onSelect={onSelectAgent}
        />
      ))}

      {(counts.running > 0 || counts.error > 0) && (
        <div className={styles.summary}>
          {counts.running > 0 && (
            <div className={styles.summaryItem}>
              <span
                className={`${styles.statusDot} ${styles.statusRunning}`}
              />
              {counts.running} running
            </div>
          )}
          {counts.idle > 0 && (
            <div className={styles.summaryItem}>
              <span className={`${styles.statusDot} ${styles.statusIdle}`} />
              {counts.idle} idle
            </div>
          )}
          {counts.stopped > 0 && (
            <div className={styles.summaryItem}>
              <span
                className={`${styles.statusDot} ${styles.statusStopped}`}
              />
              {counts.stopped} done
            </div>
          )}
          {counts.error > 0 && (
            <div className={styles.summaryItem}>
              <span
                className={`${styles.statusDot} ${styles.statusError}`}
              />
              {counts.error} error
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AgentNodeRow({
  node,
  depth,
  activeAgentId,
  onSelect,
}: {
  activeAgentId: string | null;
  depth: number;
  node: AgentNode;
  onSelect: (agentId: string, workspaceId: string) => void;
}) {
  const isActive = node.agent.agent_id === activeAgentId;
  const isOrchestrator = node.children.length > 0;
  const label =
    node.displayName ?? node.branch ?? node.agent.agent_id.slice(0, 8);

  return (
    <>
      <div
        className={`${styles.agentRow} ${isActive ? styles.agentRowActive : ""} ${depth > 0 ? styles.childRow : ""}`}
        onClick={() =>
          onSelect(node.agent.agent_id, node.agent.workspace_id)
        }
      >
        {depth > 0 && <span className={styles.connector} />}
        <span
          className={`${styles.statusDot} ${statusClass(node.agent.status)}`}
          title={node.agent.status}
        />
        <span className={styles.agentName}>{label}</span>
        {isOrchestrator && (
          <span className={styles.orchestratorBadge}>orchestrator</span>
        )}
        {node.branch && depth > 0 && (
          <span className={styles.agentBranch}>{node.branch}</span>
        )}
        <span className={styles.statusLabel}>{node.agent.status}</span>
      </div>
      {node.children.map((child) => (
        <AgentNodeRow
          key={child.agent.agent_id}
          activeAgentId={activeAgentId}
          depth={depth + 1}
          node={child}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
