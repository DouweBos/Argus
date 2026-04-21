import type { Session } from "../../lib/types";
import { Icons } from "@argus/peacock";
import { error as logError } from "@logger";
import { stopTerminal } from "../../lib/ipc";
import { useSessions } from "../../stores/sessionStore";
import styles from "./RuntimeScreen.module.css";
import { useRuntimeNavigation } from "./runtimeNav";
import { useRunningRuntimes } from "./useRunningRuntimes";

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

function sessionLabel(session: Session): string {
  if (session.kind === "project_root") {
    return "project root";
  }

  return session.display_name || session.branch;
}

export function RuntimeScreen() {
  const sessions = useSessions();
  const runtimes = useRunningRuntimes();
  const { goto } = useRuntimeNavigation();

  const running = runtimes.filter((r) => r.alive).length;
  const stopped = runtimes.length - running;

  const rows = runtimes
    .map((r) => {
      const session = sessions.find((s) => s.id === r.sessionId) ?? null;

      return session ? { ...r, session } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const nav =
    (kind: "project" | "runtime" | "session", row: (typeof rows)[number]) =>
    (e: React.MouseEvent) => {
      e.stopPropagation();
      goto(
        {
          repoRoot: row.session.repo_root,
          sessionId: row.session.id,
          terminalId: row.terminalId,
        },
        kind,
      ).catch(() => {});
    };

  const handleStop =
    (terminalId: string) =>
    async (e: React.MouseEvent<HTMLButtonElement>): Promise<void> => {
      e.stopPropagation();
      try {
        await stopTerminal(terminalId);
      } catch (err) {
        logError("stop runtime failed:", err);
      }
    };

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <span className={styles.title}>Runtimes</span>
        <span className={styles.sub}>
          {rows.length} total · {running} running · {stopped} stopped
        </span>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>
          No dev servers running. Start one from a session to see it here.
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Process</th>
              <th>Status</th>
              <th>Session</th>
              <th>Project</th>
              <th className={styles.actionCell} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.terminalId}
                className={styles.row}
                onClick={() =>
                  goto(
                    {
                      repoRoot: r.session.repo_root,
                      sessionId: r.session.id,
                      terminalId: r.terminalId,
                    },
                    "runtime",
                  ).catch(() => {})
                }
              >
                <td className={styles.name}>
                  <span
                    className={`${styles.statusDot} ${
                      r.alive ? styles.running : styles.stopped
                    }`}
                    aria-label={r.alive ? "running" : "stopped"}
                  />
                  {r.title}
                </td>
                <td>
                  <span className={styles.statusBadge}>
                    {r.alive ? "running" : "stopped"}
                  </span>
                </td>
                <td>
                  <button className={styles.link} onClick={nav("session", r)}>
                    {sessionLabel(r.session)}
                  </button>
                </td>
                <td>
                  <button className={styles.link} onClick={nav("project", r)}>
                    {basename(r.session.repo_root)}
                  </button>
                </td>
                <td className={styles.actionCell}>
                  {r.alive && (
                    <button
                      className={styles.iconBtn}
                      title="Stop process"
                      type="button"
                      onClick={handleStop(r.terminalId)}
                    >
                      <Icons.StopIcon size={11} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
