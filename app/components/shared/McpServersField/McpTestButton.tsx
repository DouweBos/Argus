import type { McpTestResult } from "../../../lib/types";
import { useState } from "react";
import { Button, Icons } from "@argus/peacock";
import { testMcpServer } from "../../../lib/ipc";
import styles from "./McpTestButton.module.css";

interface McpTestButtonProps {
  /**
   * The parsed server config (matches one entry under `mcpServers`).
   * Pass `null` when the editable JSON is invalid — the button will be
   * disabled instead of disappearing.
   */
  config: Record<string, unknown> | null;
}

type State =
  | { kind: "done"; result: McpTestResult }
  | { kind: "idle" }
  | { kind: "running" };

function formatDoneLabel(r: McpTestResult): string {
  if (r.ok) {
    return r.latencyMs !== undefined ? `OK · ${r.latencyMs} ms` : "OK";
  }

  return r.error ?? "Failed";
}

function tooltipFor(r: McpTestResult): string {
  const lines: string[] = [];
  lines.push(`transport: ${r.transport}`);
  if (r.protocolVersion) {
    lines.push(`protocol: ${r.protocolVersion}`);
  }
  if (r.serverInfo?.name) {
    const v = r.serverInfo.version ? ` ${r.serverInfo.version}` : "";
    lines.push(`server: ${r.serverInfo.name}${v}`);
  }
  if (r.latencyMs !== undefined) {
    lines.push(`latency: ${r.latencyMs} ms`);
  }
  if (r.error) {
    lines.push(`error: ${r.error}`);
  }

  return lines.join("\n");
}

export function McpTestButton({ config }: McpTestButtonProps) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const run = async () => {
    if (!config) {
      return;
    }
    setState({ kind: "running" });
    try {
      const result = await testMcpServer(config);
      setState({ kind: "done", result });
    } catch (err) {
      setState({
        kind: "done",
        result: {
          ok: false,
          transport: "unknown",
          error: (err as Error).message,
        },
      });
    }
  };

  if (state.kind === "running") {
    return (
      <Button
        disabled
        size="sm"
        variant="ghost"
        leading={<Icons.RefreshIcon className={styles.spin} size={12} />}
      >
        Testing…
      </Button>
    );
  }

  if (state.kind === "done") {
    const r = state.result;
    const cls = r.ok ? styles.ok : styles.fail;
    const icon = r.ok ? (
      <Icons.CheckIcon size={12} />
    ) : (
      <Icons.WarningIcon size={12} />
    );

    return (
      <button
        className={`${styles.result} ${cls}`}
        title={tooltipFor(r)}
        type="button"
        onClick={() => {
          run();
        }}
      >
        {icon}
        <span className={styles.label}>{formatDoneLabel(r)}</span>
      </button>
    );
  }

  return (
    <Button
      disabled={!config}
      size="sm"
      variant="ghost"
      onClick={() => {
        run();
      }}
    >
      Test
    </Button>
  );
}
