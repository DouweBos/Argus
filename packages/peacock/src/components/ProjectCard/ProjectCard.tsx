import type { CSSProperties, HTMLAttributes, MouseEventHandler } from "react";
import styles from "./ProjectCard.module.css";
import { FolderIcon } from "../../icons/Icons";
import { StarIcon } from "../../icons/HomeIcons";
import {
  PlatformChip,
  type Platform,
} from "../PlatformChip/PlatformChip";
import { StatusDot } from "../Badge/Badge";
import {
  agentStatusTone,
  type AgentStatus,
} from "../../lib/agentStatus";

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
  agents?: ProjectCardAgent[];
  lastOpened?: string;
}

function pickPillStatus(agents: ProjectCardAgent[]): AgentStatus | "empty" {
  if (!agents.length) return "empty";
  if (agents.some((a) => a.status === "error")) return "error";
  if (agents.some((a) => a.status === "pending")) return "pending";
  if (agents.some((a) => a.status === "running")) return "running";
  return "idle";
}

export function ProjectCard({
  name,
  path,
  platform,
  accent,
  starred,
  onToggleStar,
  agents = [],
  lastOpened,
  className,
  style,
  ...rest
}: ProjectCardProps) {
  const pillStatus = pickPillStatus(agents);
  const pillClass =
    pillStatus === "error"
      ? styles.err
      : pillStatus === "pending"
        ? styles.warn
        : pillStatus === "running"
          ? ""
          : styles.muted;

  const dotStatus: AgentStatus =
    pillStatus === "empty" ? "idle" : (pillStatus as AgentStatus);
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
        <div className={styles.badge}>
          <FolderIcon size={14} />
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

      {(platform || path) && (
        <div className={styles.meta}>
          {platform && <PlatformChip platform={platform} />}
          {path && <span className={styles.path}>{path}</span>}
        </div>
      )}

      <div className={styles.foot}>
        {agents.length > 0 ? (
          <span
            className={[styles.agentPill, pillClass].filter(Boolean).join(" ")}
          >
            <StatusDot
              tone={agentStatusTone(dotStatus)}
              pulse={dotStatus === "running" || dotStatus === "pending"}
            />
            {running} running · {agents.length} total
          </span>
        ) : (
          <span className={[styles.agentPill, styles.muted].join(" ")}>
            no agents
          </span>
        )}
        {lastOpened && <span className={styles.when}>{lastOpened}</span>}
      </div>
    </div>
  );
}
