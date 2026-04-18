import { useHomeData, type HomeAgent } from "../home/HomeScreen/useHomeData";
import styles from "./AgentsScreen.module.css";
import { useAgentNavigation } from "./agentNav";

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

function statusLabel(status: HomeAgent["status"]): string {
  if (status === "running") {
    return "running";
  }
  if (status === "error") {
    return "error";
  }
  if (status === "done") {
    return "stopped";
  }

  return "idle";
}

function statusClass(status: HomeAgent["status"]): string {
  if (status === "running") {
    return styles.running;
  }
  if (status === "error") {
    return styles.error;
  }
  if (status === "idle") {
    return styles.idle;
  }

  return "";
}

export function AgentsScreen() {
  const { activeAgents } = useHomeData();
  const { goto } = useAgentNavigation();

  const running = activeAgents.filter((a) => a.status === "running").length;
  const errored = activeAgents.filter((a) => a.status === "error").length;
  const idle = activeAgents.filter((a) => a.status === "idle").length;

  const nav =
    (kind: "agent" | "project" | "workspace", a: HomeAgent) =>
    (e: React.MouseEvent) => {
      e.stopPropagation();
      goto(
        {
          agentId: a.id,
          repoRoot: a.workspace.repo_root,
          workspaceId: a.workspace.id,
        },
        kind,
      ).catch(() => {});
    };

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <span className={styles.title}>Agents</span>
        <span className={styles.sub}>
          {activeAgents.length} total · {running} running · {idle} idle ·{" "}
          {errored} errored
        </span>
      </div>

      {activeAgents.length === 0 ? (
        <div className={styles.empty}>
          No agents running. Start one from a workspace to see it here.
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Status</th>
              <th>Branch</th>
              <th>Workspace</th>
              <th>Project</th>
            </tr>
          </thead>
          <tbody>
            {activeAgents.map((a) => (
              <tr
                key={a.id}
                className={styles.row}
                onClick={() =>
                  goto(
                    {
                      agentId: a.id,
                      repoRoot: a.workspace.repo_root,
                      workspaceId: a.workspace.id,
                    },
                    "agent",
                  ).catch(() => {})
                }
              >
                <td className={styles.name}>
                  <span
                    className={`${styles.statusDot} ${statusClass(a.status)}`}
                    aria-label={statusLabel(a.status)}
                  />
                  {a.id.slice(0, 8)}
                </td>
                <td>
                  <span className={styles.statusBadge}>
                    {statusLabel(a.status)}
                  </span>
                </td>
                <td className={styles.muted}>{a.branch}</td>
                <td>
                  <button className={styles.link} onClick={nav("workspace", a)}>
                    {a.workspace.id.slice(0, 8)}
                  </button>
                </td>
                <td>
                  <button className={styles.link} onClick={nav("project", a)}>
                    {basename(a.workspace.repo_root)}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
