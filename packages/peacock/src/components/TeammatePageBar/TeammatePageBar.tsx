import type { TeammatePage } from "@argus/client-core";
import type { ReactNode } from "react";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import styles from "./TeammatePageBar.module.css";

const PAGES: { value: TeammatePage; label: string }[] = [
  { value: "chat", label: "Conversation" },
  { value: "profile", label: "Profile" },
  { value: "duties", label: "Duties" },
  { value: "memory", label: "Memory" },
];

export interface TeammatePageBarProps {
  page: TeammatePage;
  onPage: (page: TeammatePage) => void;
  /** The page's own actions, trailing. */
  actions?: ReactNode;
}

/** A teammate's pages, as the Mac's toolbar picker, with the open page's actions. */
export function TeammatePageBar({
  actions,
  onPage,
  page,
}: TeammatePageBarProps) {
  return (
    <div className={styles.bar}>
      <SegmentedControl
        aria-label="Page"
        options={PAGES}
        value={page}
        onChange={onPage}
      />
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
