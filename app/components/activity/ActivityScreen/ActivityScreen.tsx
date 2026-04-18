import type { ActivityEvent, ActivityKind } from "../../../lib/activityTypes";
import type { ReactNode } from "react";
import { CommitIcon, EmptyState, Icons, WarningIcon } from "@argus/peacock";
import { useActivityEvents } from "../../../stores/activityStore";
import styles from "./ActivityScreen.module.css";

function projectName(repoRoot: string | undefined): string {
  if (!repoRoot) {
    return "";
  }

  return repoRoot.split(/[/\\]/).filter(Boolean).pop() ?? repoRoot;
}

function relativeTime(ts: number): string {
  const delta = Date.now() - ts;
  const sec = Math.floor(delta / 1000);
  if (sec < 5) {
    return "just now";
  }
  if (sec < 60) {
    return `${sec}s`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}h`;
  }
  const day = Math.floor(hr / 24);

  return `${day}d`;
}

function kindIcon(kind: ActivityKind): ReactNode {
  switch (kind) {
    case "agent_spawned":
      return <Icons.AgentStartIcon size={13} />;
    case "agent_stopped":
      return <Icons.StopIcon size={13} />;
    case "agent_errored":
      return <WarningIcon size={13} />;
    case "workspace_created":
      return <Icons.PlusIcon size={13} />;
    case "workspace_merged":
      return <Icons.MergeIcon size={13} />;
    case "workspace_deleted":
      return <Icons.TrashIcon size={13} />;
    case "commit_landed":
      return <CommitIcon size={13} />;
    case "device_online":
      return <Icons.BootIcon size={13} />;
    case "device_offline":
      return <Icons.DisconnectIcon size={13} />;
  }
}

function kindToneClass(kind: ActivityKind): string {
  switch (kind) {
    case "agent_errored":
      return styles.toneError;
    case "agent_spawned":
    case "workspace_created":
    case "device_online":
      return styles.toneSuccess;
    case "workspace_merged":
    case "commit_landed":
      return styles.toneAccent;
    case "agent_stopped":
    case "workspace_deleted":
    case "device_offline":
      return styles.toneMuted;
  }
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const project = projectName(event.repoRoot);

  return (
    <div className={styles.row}>
      <div className={[styles.icon, kindToneClass(event.kind)].join(" ")}>
        {kindIcon(event.kind)}
      </div>
      <div className={styles.body}>
        <div className={styles.top}>
          {project && <span className={styles.projectChip}>{project}</span>}
          {event.branch && (
            <span className={styles.branchChip}>{event.branch}</span>
          )}
        </div>
        <div className={styles.title}>{event.title}</div>
        {event.detail && <div className={styles.detail}>{event.detail}</div>}
      </div>
      <div className={styles.time}>{relativeTime(event.ts)}</div>
    </div>
  );
}

export function ActivityScreen() {
  const events = useActivityEvents();

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <span className={styles.titleHeading}>Activity</span>
        <span className={styles.sub}>
          {events.length === 0
            ? "No events recorded"
            : `${events.length} recent event${events.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={<CommitIcon size={20} />}
          title="Nothing has happened yet"
          body="Agent runs, commits, merges, and device state changes will show up here as they occur."
        />
      ) : (
        <div className={styles.list}>
          {events.map((event) => (
            <ActivityRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
