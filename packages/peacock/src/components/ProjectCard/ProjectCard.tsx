import type { AgentStatus } from "../../lib/agentStatus";
import type {
  CSSProperties,
  HTMLAttributes,
  MouseEventHandler,
  ReactNode,
} from "react";
import { StarIcon } from "../../icons/HomeIcons";
import { FolderIcon, PlusIcon } from "../../icons/Icons";
import { HostBadge } from "../HostBadge/HostBadge";
import { PlatformChip, type Platform } from "../PlatformChip/PlatformChip";
import styles from "./ProjectCard.module.css";

export interface ProjectCardAgent {
  status: AgentStatus;
}

export interface ProjectCardProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  path?: string;
  platform?: Platform;
  /** Accent color used for the folder badge + hover top-border. */
  accent?: string;
  starred?: boolean;
  onToggleStar?: MouseEventHandler<HTMLButtonElement>;
  /** When provided, renders a "+" action on the card that creates a new session. */
  onNewSession?: MouseEventHandler<HTMLButtonElement>;
  agents?: ProjectCardAgent[];
  lastOpened?: string;
  /** Override the default folder badge icon. */
  icon?: ReactNode;
  /** Machine this repo lives on. Omit for this Mac — only shown when it matters. */
  hostLabel?: string;
}

function pickPillStatus(agents: ProjectCardAgent[]): AgentStatus | "empty" {
  if (!agents.length) {
    return "empty";
  }
  if (agents.some((a) => a.status === "error")) {
    return "error";
  }
  if (agents.some((a) => a.status === "pending")) {
    return "pending";
  }
  if (agents.some((a) => a.status === "running")) {
    return "running";
  }

  return "idle";
}

function pickPillClass(
  pillStatus: AgentStatus | "empty",
  s: Record<string, string>,
): string {
  if (pillStatus === "error") {
    return s.err;
  }
  if (pillStatus === "pending") {
    return s.warn;
  }
  if (pillStatus === "running") {
    return "";
  }

  return s.muted;
}

export function ProjectCard({
  name,
  path,
  hostLabel,
  platform,
  accent,
  starred,
  onToggleStar,
  onNewSession,
  agents = [],
  lastOpened,
  icon,
  className,
  style,
  ...rest
}: ProjectCardProps) {
  const pillStatus = pickPillStatus(agents);
  const pillClass = pickPillClass(pillStatus, styles);

  const running = agents.filter((a) => a.status === "running").length;

  const mergedStyle: CSSProperties = accent
    ? ({ ...style, ["--card-accent" as string]: accent } as CSSProperties)
    : (style ?? {});

  return (
    <div
      className={[styles.card, className].filter(Boolean).join(" ")}
      style={mergedStyle}
      {...rest}
    >
      <div className={styles.head}>
        <div
          className={styles.badge}
          title={
            running > 0
              ? `${running} agent${running > 1 ? "s" : ""} running`
              : undefined
          }
        >
          {icon ?? <FolderIcon size={14} />}
        </div>
        <div className={styles.name}>{name}</div>
        <button
          type="button"
          className={[styles.star, starred ? styles.on : ""]
            .filter(Boolean)
            .join(" ")}
          aria-label={starred ? "Unstar project" : "Star project"}
          onClick={onToggleStar}
        >
          <StarIcon size={11} filled={starred} />
        </button>
      </div>

      {(platform || path || hostLabel) && (
        <div className={styles.meta}>
          {platform && <PlatformChip platform={platform} />}
          {hostLabel && <HostBadge label={hostLabel} />}
          {path && <span className={styles.path}>{path}</span>}
        </div>
      )}

      <div className={styles.foot}>
        {agents.length > 0 ? (
          <span
            className={[styles.agentPill, pillClass].filter(Boolean).join(" ")}
          >
            {running} running · {agents.length} total
          </span>
        ) : (
          <span className={[styles.agentPill, styles.muted].join(" ")}>
            no agents
          </span>
        )}
        {onNewSession && (
          <button
            type="button"
            className={styles.newSession}
            aria-label="New session"
            title="New session"
            onClick={(e) => {
              e.stopPropagation();
              onNewSession(e);
            }}
          >
            <PlusIcon size={11} />
            <span>New session</span>
          </button>
        )}
        {lastOpened && <span className={styles.when}>{lastOpened}</span>}
      </div>
    </div>
  );
}
