import styles from "./ReportList.module.css";

export type ReportListTone = "critical" | "info" | "positive" | "warning";

export interface ReportListItem {
  href?: string;
  text: string;
  tone?: ReportListTone;
}

export interface ReportListProps {
  items: ReportListItem[];
  /** Intercepts a link so the host can open it its own way. */
  onOpenLink?: (href: string) => void;
}

const TONE_CLASS: Record<ReportListTone, string> = {
  critical: styles.critical,
  info: styles.info,
  positive: styles.positive,
  warning: styles.warning,
};

/** The `list` block — findings, each optionally toned and linked. */
export function ReportList({ items, onOpenLink }: ReportListProps) {
  return (
    <ul className={styles.list}>
      {items.map((item, i) => (
        <li key={`${item.text}-${i}`} className={styles.item}>
          <span
            className={[styles.dot, item.tone ? TONE_CLASS[item.tone] : ""]
              .filter(Boolean)
              .join(" ")}
            aria-hidden
          />
          <ReportListText item={item} onOpenLink={onOpenLink} />
        </li>
      ))}
    </ul>
  );
}

function ReportListText({
  item,
  onOpenLink,
}: {
  item: ReportListItem;
  onOpenLink?: (href: string) => void;
}) {
  const href = item.href;
  if (!href) {
    return <span className={styles.text}>{item.text}</span>;
  }

  return (
    <a
      className={styles.link}
      href={href}
      onClick={(e) => {
        if (onOpenLink) {
          e.preventDefault();
          onOpenLink(href);
        }
      }}
    >
      {item.text}
    </a>
  );
}
