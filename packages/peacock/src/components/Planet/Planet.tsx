import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import styles from "./Planet.module.css";
import { FolderIcon, ArrowForwardIcon } from "../../icons/Icons";
import { StatusDot } from "../Badge/Badge";
import { DiffStat } from "../DiffStat/DiffStat";
import {
  agentStatusPulse,
  agentStatusTone,
  type AgentStatus,
} from "../../lib/agentStatus";
import { PlatformChip, type Platform } from "../PlatformChip/PlatformChip";

export interface PlanetAgent {
  id?: string;
  name: ReactNode;
  status: AgentStatus;
  /** Short label for the trailing side (e.g., "running", "perm", "blocked"). */
  tool?: ReactNode;
}

export interface PlanetProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  branch?: string;
  platform?: Platform;
  /** Last-opened or last-commit text. */
  when?: string;
  /** Planet's accent color. */
  accent?: string;
  /** Optional glow color (defaults to accent + 33% alpha). */
  accentGlow?: string;
  /** Index-based corner hint used to position the ambient gradient. */
  facing?: "left" | "right";
  agents?: PlanetAgent[];
  /** Shown when agents[] is empty. */
  emptyLabel?: ReactNode;
  diff?: { add: number; del: number; files: number };
  /** Displayed in the footer action pill. */
  openLabel?: ReactNode;
}

export function Planet({
  name,
  branch,
  platform,
  when,
  accent,
  accentGlow,
  facing = "right",
  agents = [],
  emptyLabel,
  diff,
  openLabel = "Open",
  className,
  style,
  ...rest
}: PlanetProps) {
  const hasLive = agents.some((a) => a.status === "running");
  const mergedStyle: CSSProperties = {
    ...style,
    ...(accent ? { ["--planet-accent" as string]: accent } : {}),
    ...(accentGlow || accent
      ? {
          ["--planet-glow" as string]:
            accentGlow ?? `${accent}33`,
        }
      : {}),
    ["--px" as string]: facing === "left" ? "0%" : "100%",
    ["--py" as string]: "0%",
  } as CSSProperties;

  return (
    <div
      className={[styles.planet, hasLive ? styles.pulse : "", className]
        .filter(Boolean)
        .join(" ")}
      style={mergedStyle}
      {...rest}
    >
      <div className={styles.row}>
        <div className={[styles.icon, hasLive ? styles.live : ""].filter(Boolean).join(" ")}>
          <FolderIcon size={14} />
        </div>
        <div className={styles.name}>{name}</div>
        {when && <span className={styles.when}>{when}</span>}
      </div>

      {(platform || branch) && (
        <div className={styles.row}>
          {platform && <PlatformChip platform={platform} />}
          {branch && <span className={styles.path}>{branch}</span>}
        </div>
      )}

      <div className={styles.agents}>
        {agents.length === 0 ? (
          <div className={styles.empty}>{emptyLabel ?? "no agents"}</div>
        ) : (
          <>
            {agents.slice(0, 2).map((a, i) => (
              <div key={a.id ?? i} className={styles.agentMini}>
                <StatusDot
                  tone={agentStatusTone(a.status)}
                  pulse={agentStatusPulse(a.status)}
                />
                <span className={styles.agentName}>{a.name}</span>
                <span className={styles.tool}>{a.tool ?? a.status}</span>
              </div>
            ))}
            {agents.length > 2 && (
              <div className={styles.agentMini}>
                <span className={styles.tool}>+ {agents.length - 2} more</span>
              </div>
            )}
          </>
        )}
      </div>

      <div className={styles.foot}>
        {diff && diff.files > 0 ? (
          <DiffStat added={diff.add} removed={diff.del} files={diff.files} />
        ) : (
          <span className={styles.tool}>clean</span>
        )}
        <span className={styles.open}>
          {openLabel} <ArrowForwardIcon size={10} />
        </span>
      </div>
    </div>
  );
}
