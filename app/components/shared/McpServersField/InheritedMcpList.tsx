import type { InheritedMcpServer, McpTool } from "../../../lib/types";
import { useEffect, useState } from "react";
import { StatusBulb, type StatusBulbTone } from "@argus/peacock";
import { listInheritedMcpServers } from "../../../lib/ipc";
import styles from "./InheritedMcpList.module.css";
import { McpTestButton, type McpProbeStatus } from "./McpTestButton";

interface InheritedMcpListProps {
  /** Pass null/undefined for the global (app-level) view. */
  worktreePath?: string | null;
}

const TONE_BY_STATUS: Record<McpProbeStatus, StatusBulbTone> = {
  ok: "success",
  fail: "error",
  "needs-auth": "error",
  testing: "pending",
  unknown: "neutral",
};

const LABEL_BY_STATUS: Record<McpProbeStatus, string> = {
  ok: "Connected",
  fail: "Failed",
  "needs-auth": "Requires authentication",
  testing: "Checking…",
  unknown: "Not yet checked",
};

export function InheritedMcpList({ worktreePath }: InheritedMcpListProps) {
  const [servers, setServers] = useState<InheritedMcpServer[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, McpProbeStatus>>({});

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
        <Row
          key={`${s.source}:${s.name}:${i}`}
          rowKey={`${s.source}:${s.name}:${i}`}
          server={s}
          status={statuses[`${s.source}:${s.name}:${i}`] ?? "unknown"}
          setStatuses={setStatuses}
        />
      ))}
    </div>
  );
}

interface RowProps {
  rowKey: string;
  server: InheritedMcpServer;
  setStatuses: React.Dispatch<
    React.SetStateAction<Record<string, McpProbeStatus>>
  >;
  status: McpProbeStatus;
}

const TOOL_COLLAPSE_AT = 10;

function ToolList({ tools }: { tools: McpTool[] }) {
  const [expanded, setExpanded] = useState(false);
  const overflow = tools.length - TOOL_COLLAPSE_AT;
  const visible =
    expanded || overflow <= 0 ? tools : tools.slice(0, TOOL_COLLAPSE_AT);

  return (
    <div className={styles.tools}>
      <div className={styles.toolsLabel}>
        {tools.length} tool{tools.length === 1 ? "" : "s"}
      </div>
      <div className={styles.toolChips}>
        {visible.map((t) => (
          <span
            key={t.name}
            className={styles.toolChip}
            title={t.description ?? t.name}
          >
            {t.name}
          </span>
        ))}
        {overflow > 0 && !expanded ? (
          <button
            type="button"
            className={styles.toolChipMore}
            onClick={() => {
              setExpanded(true);
            }}
          >
            +{overflow} more
          </button>
        ) : null}
        {overflow > 0 && expanded ? (
          <button
            type="button"
            className={styles.toolChipMore}
            onClick={() => {
              setExpanded(false);
            }}
          >
            Show less
          </button>
        ) : null}
      </div>
    </div>
  );
}

function summarizeConfig(config: Record<string, unknown>): string | null {
  const url = config.url;
  if (typeof url === "string") {
    return url;
  }
  const command = config.command;
  if (typeof command === "string") {
    const args = Array.isArray(config.args)
      ? (config.args as unknown[]).map(String).join(" ")
      : "";

    return args ? `${command} ${args}` : command;
  }

  return null;
}

function Row({ rowKey, server, status, setStatuses }: RowProps) {
  const tone = TONE_BY_STATUS[status];
  const summary = summarizeConfig(server.config);
  const [tools, setTools] = useState<McpTool[] | undefined>(undefined);

  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <span className={styles.nameWrap}>
          <StatusBulb
            tone={tone}
            pulse={status === "testing"}
            title={LABEL_BY_STATUS[status]}
          />
          <span className={styles.name}>{server.name}</span>
        </span>
        <span className={styles.source}>{server.source}</span>
      </div>
      {summary ? <div className={styles.summary}>{summary}</div> : null}
      {status === "ok" && tools && tools.length > 0 ? (
        <ToolList tools={tools} />
      ) : null}
      <div className={styles.actions}>
        <McpTestButton
          config={server.config}
          autoTest
          onStatusChange={(s) => {
            setStatuses((prev) =>
              prev[rowKey] === s ? prev : { ...prev, [rowKey]: s },
            );
          }}
          onToolsChange={setTools}
        />
      </div>
    </div>
  );
}
