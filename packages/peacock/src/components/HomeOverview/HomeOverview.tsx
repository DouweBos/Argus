import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  KeyboardEvent,
  ReactNode,
} from "react";
import { PlusIcon } from "../../icons/Icons";
import { StatusDot, type StatusTone } from "../Badge/Badge";
import { FlatIconButton } from "../FlatIconButton/FlatIconButton";
import { ProjectBadge } from "../ProjectBadge/ProjectBadge";
import styles from "./HomeOverview.module.css";

/** Argus for Mac's Home: a reading column of titled sections under a masthead. */
export function HomeOverview({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.home}>
      <header className={styles.masthead}>
        {icon && <span className={styles.mastIcon}>{icon}</span>}
        <h1 className={styles.mastTitle}>{title}</h1>
      </header>
      {children}
    </div>
  );
}

export interface HomeSectionProps extends HTMLAttributes<HTMLElement> {
  title: string;
  /** Links on the far side, e.g. "View usage". */
  actions?: ReactNode;
}

/** An uppercase section label with its links on the right, then its rows. */
export function HomeSection({
  title,
  actions,
  children,
  className,
  ...rest
}: HomeSectionProps) {
  return (
    <section
      className={[styles.section, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {actions && <div className={styles.sectionActions}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A quiet text link in a section's header. */
export function HomeLink({
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={[styles.link, className].filter(Boolean).join(" ")}
      type={type}
      {...rest}
    />
  );
}

/** A note in place of a section's rows. */
export function HomeNote({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}

export interface ProjectTileProps {
  name: string;
  /** The repo root: colours the badge. Never shown. */
  projectKey: string;
  /** "2 sessions · 1 agent". */
  summary: string;
  status?: StatusTone;
  busy?: boolean;
  /** "21m ago". */
  age?: string;
  onOpen: () => void;
  onNewSession?: () => void;
}

/** A project on Home: badge and name, what's in it, and how long since it moved. */
export function ProjectTile({
  name,
  projectKey,
  summary,
  status,
  busy,
  age,
  onOpen,
  onNewSession,
}: ProjectTileProps) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };

  return (
    <div
      className={styles.tile}
      role="button"
      tabIndex={0}
      title={name}
      onClick={onOpen}
      onKeyDown={onKey}
    >
      <div className={styles.tileHead}>
        <ProjectBadge name={name} projectKey={projectKey} size="md" />
        <span className={styles.tileName}>{name}</span>
        {onNewSession && (
          <FlatIconButton
            icon={<PlusIcon size={12} />}
            label={`New session in ${name}`}
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onNewSession();
            }}
          />
        )}
      </div>
      <div className={styles.tileMeta}>
        <StatusDot pulse={busy} tone={status ?? "idle"} />
        <span className={styles.tileSummary}>{summary}</span>
        {age && <span className={styles.tileAge}>{age}</span>}
      </div>
    </div>
  );
}

/** Tiles in rows, as many as fit. */
export function ProjectTileGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}
