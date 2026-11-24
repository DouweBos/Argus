import type {
  TeammateAvatar as TeammateLook,
  TeammateColor,
} from "@argus/remote-protocol";
import type { ReactNode } from "react";
import { StatusDot } from "../Badge/Badge";
import { TeammateAvatar } from "../TeammateAvatar/TeammateAvatar";
import { Toggle } from "../Toggle/Toggle";
import styles from "./TeammateRow.module.css";

export interface TeammateRowProps {
  name: string;
  handle: string;
  tagline?: string;
  color: TeammateColor;
  avatar: TeammateLook;
  enabled: boolean;
  /** Disables the switch where this client may not change it. */
  enableDisabled?: boolean;
  dutyCount: number;
  lastRunLabel: ReactNode;
  /** A duty has a report nobody has read. */
  unread?: boolean;
  actions?: ReactNode;
  onOpen?: () => void;
  onToggleEnabled: (enabled: boolean) => void;
}

/** One teammate in the list: who it is, its duties, when it last did anything, and its switch. */
export function TeammateRow({
  actions,
  avatar,
  color,
  dutyCount,
  enableDisabled,
  enabled,
  handle,
  lastRunLabel,
  name,
  onOpen,
  onToggleEnabled,
  tagline,
  unread,
}: TeammateRowProps) {
  return (
    <div className={styles.row}>
      <Toggle
        checked={enabled}
        disabled={enableDisabled}
        size="sm"
        onChange={onToggleEnabled}
      />
      <button className={styles.main} type="button" onClick={onOpen}>
        <TeammateAvatar avatar={avatar} color={color} name={name} size={30} />
        <span className={styles.text}>
          <span className={styles.titleLine}>
            <span className={styles.name}>{name}</span>
            <span className={styles.handle}>@{handle}</span>
          </span>
          {tagline && <span className={styles.tagline}>{tagline}</span>}
        </span>
      </button>
      <div className={styles.meta}>
        <span className={styles.metaLabel}>Duties</span>
        <span className={styles.metaValue}>
          {dutyCount === 1 ? "1 duty" : `${dutyCount} duties`}
        </span>
      </div>
      <div className={styles.meta}>
        <span className={styles.metaLabel}>Last run</span>
        <span className={styles.metaValue}>
          {unread && <StatusDot aria-label="New report" tone="accent" />}
          {lastRunLabel}
        </span>
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
