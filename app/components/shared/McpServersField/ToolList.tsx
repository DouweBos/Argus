import type { McpTool } from "../../../lib/types";
import { useState } from "react";
import styles from "./InheritedMcpList.module.css";

const TOOL_COLLAPSE_AT = 10;

export function ToolList({ tools }: { tools: McpTool[] }) {
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
