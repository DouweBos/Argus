import type {
  TeammateAvatar as TeammateLook,
  TeammateColor,
} from "@argus/remote-protocol";
import type { ReactNode } from "react";
import { ClockIcon } from "../../icons/Icons";
import { Badge } from "../Badge/Badge";
import { TeammateAvatar } from "../TeammateAvatar/TeammateAvatar";
import styles from "./TeammateTemplateCard.module.css";

export interface TeammateTemplateCardProps {
  name: string;
  handle: string;
  tagline: string;
  color: TeammateColor;
  avatar: TeammateLook;
  /** Its autonomy rung, labelled. */
  autonomy: string;
  dutyNames: string[];
  /** Integrations it needs, e.g. "GitHub and Linear". */
  needs?: string;
  onPick?: () => void;
}

/** A starting teammate in the gallery: who it is, how far it goes and its duties. */
export function TeammateTemplateCard({
  autonomy,
  avatar,
  color,
  dutyNames,
  handle,
  name,
  needs,
  onPick,
  tagline,
}: TeammateTemplateCardProps) {
  return (
    <button
      className={styles.card}
      disabled={!onPick}
      type="button"
      onClick={onPick}
    >
      <span className={styles.head}>
        <TeammateAvatar avatar={avatar} color={color} name={name} size={34} />
        <span className={styles.identity}>
          <span className={styles.name}>{name}</span>
          <span className={styles.handle}>@{handle}</span>
        </span>
        <Badge size="tag" tone="neutral">
          {autonomy}
        </Badge>
      </span>
      <span className={styles.tagline}>{tagline}</span>
      {dutyNames.length > 0 && (
        <span className={styles.duties}>
          {dutyNames.map((duty) => (
            <span className={styles.duty} key={duty}>
              <ClockIcon size={11} />
              {duty}
            </span>
          ))}
        </span>
      )}
      {needs && <span className={styles.needs}>Needs {needs}</span>}
    </button>
  );
}

/** The gallery's cards, as many across as fit. */
export function TeammateTemplateGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}
