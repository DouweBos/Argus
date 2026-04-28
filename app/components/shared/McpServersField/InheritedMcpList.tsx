import type { InheritedMcpServer } from "../../../lib/types";
import { useEffect, useState } from "react";
import { listInheritedMcpServers } from "../../../lib/ipc";
import styles from "./InheritedMcpList.module.css";

interface InheritedMcpListProps {
  /** Pass null/undefined for the global (app-level) view. */
  worktreePath?: string | null;
}

export function InheritedMcpList({ worktreePath }: InheritedMcpListProps) {
  const [servers, setServers] = useState<InheritedMcpServer[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listInheritedMcpServers(worktreePath).then(
      (list) => {
        if (!cancelled) {
          setServers(list);
        }
      },
      () => {
        if (!cancelled) {
          setServers([]);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [worktreePath]);

  if (servers === null) {
    return <p className={styles.hint}>Loading inherited servers…</p>;
  }
  if (servers.length === 0) {
    return (
      <p className={styles.hint}>
        No servers inherited from Claude Code, plugins, or this project&apos;s{" "}
        <code>.mcp.json</code>.
      </p>
    );
  }

  return (
    <div className={styles.list}>
      <p className={styles.hint}>
        Argus already passes these servers through to every agent — listed for
        reference, not editable here.
      </p>
      {servers.map((s, i) => (
        <div key={`${s.source}:${s.name}:${i}`} className={styles.row}>
          <div className={styles.head}>
            <span className={styles.name}>{s.name}</span>
            <span className={styles.source}>{s.source}</span>
          </div>
          <pre className={styles.config}>
            {JSON.stringify(s.config, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}
