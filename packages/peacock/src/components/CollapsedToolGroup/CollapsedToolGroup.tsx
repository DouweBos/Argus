import type { ReactNode } from "react";
import {
  AgentIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  WebIcon,
} from "../../icons/Icons";
import { HoverTimestamp } from "../HoverTimestamp/HoverTimestamp";
import styles from "./CollapsedToolGroup.module.css";

/** What a folded run's calls were, for the icons on its summary. */
export type ToolGroupCategory =
  | "agent"
  | "bash"
  | "edit"
  | "other"
  | "read"
  | "search"
  | "web";

export type ToolGroupCategoryCounts = Partial<
  Record<ToolGroupCategory, number>
>;

const CATEGORY_ICONS: {
  category: ToolGroupCategory;
  icon: ReactNode;
  noun: string;
}[] = [
  { category: "read", icon: <FileIcon size={14} />, noun: "reads" },
  { category: "search", icon: <SearchIcon size={14} />, noun: "searches" },
  { category: "bash", icon: <TerminalIcon size={14} />, noun: "commands" },
  { category: "edit", icon: <PencilIcon size={14} />, noun: "edits" },
  { category: "web", icon: <WebIcon size={14} />, noun: "web requests" },
  { category: "agent", icon: <AgentIcon size={14} />, noun: "agents" },
];

export interface CollapsedToolGroupProps {
  toolCallCount: number;
  messageCount: number;
  categories: ToolGroupCategoryCounts;
  /** "1 agent still running", appended to the summary. */
  stillRunning?: string | null;
  expanded: boolean;
  onToggle: () => void;
  /** First and last message times, shown on hover. */
  timestamp?: number;
  endTimestamp?: number;
  /** The run's tool calls, drawn while expanded. */
  children?: ReactNode;
  className?: string;
}

/** A run of consecutive tool calls folded into one summary row that opens in place. */
export function CollapsedToolGroup({
  toolCallCount,
  messageCount,
  categories,
  stillRunning,
  expanded,
  onToggle,
  timestamp,
  endTimestamp,
  children,
  className,
}: CollapsedToolGroupProps) {
  const body = (
    <>
      <button
        aria-expanded={expanded}
        className={styles.toggle}
        type="button"
        onClick={onToggle}
      >
        <span className={styles.chevron}>
          {expanded ? (
            <ChevronDownIcon size={10} />
          ) : (
            <ChevronRightIcon size={10} />
          )}
        </span>
        <span className={styles.summary}>
          {toolCallCount} tool {toolCallCount === 1 ? "call" : "calls"},{" "}
          {messageCount} {messageCount === 1 ? "message" : "messages"}
          {stillRunning && (
            <span className={styles.stillRunning}> · {stillRunning}</span>
          )}
        </span>
        <span className={styles.icons}>
          {CATEGORY_ICONS.map(({ category, icon, noun }) => {
            const count = categories[category] ?? 0;

            return count > 0 ? (
              <span
                key={category}
                className={styles.icon}
                title={`${count} ${noun}`}
              >
                {icon}
              </span>
            ) : null;
          })}
        </span>
      </button>
      {expanded && <div className={styles.expandedList}>{children}</div>}
    </>
  );
  const classes = [styles.group, className].filter(Boolean).join(" ");

  if (timestamp === undefined) {
    return <div className={classes}>{body}</div>;
  }

  return (
    <HoverTimestamp
      className={classes}
      timestamp={timestamp}
      endTimestamp={endTimestamp}
    >
      {body}
    </HoverTimestamp>
  );
}
