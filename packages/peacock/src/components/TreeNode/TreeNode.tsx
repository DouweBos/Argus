import type { ReactNode } from "react";
import styles from "./TreeNode.module.css";

export interface TreeNodeProps {
  /** The header row rendered at the top of this node. */
  header: ReactNode;
  /** Child nodes or rows rendered inside the indented region. */
  children?: ReactNode;
  /** When true the children are hidden. Header is always rendered. */
  collapsed?: boolean;
  /** Extra class for the root element. */
  className?: string;
  /** When true, renders without the indent guide (used for top-level nodes). */
  root?: boolean;
}

/**
 * Generic tree node primitive. Provides the vertical indent guide line and
 * slots for a header row and collapsible children. Domain-agnostic — wires no
 * data or events.
 */
export function TreeNode({
  header,
  children,
  collapsed = false,
  className,
  root = false,
}: TreeNodeProps) {
  const rootClass = [styles.node, root ? styles.rootNode : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass}>
      <div className={styles.header}>{header}</div>
      {!collapsed && children && (
        <div className={styles.body}>
          {!root && <div className={styles.guide} aria-hidden />}
          <div className={styles.children}>{children}</div>
        </div>
      )}
    </div>
  );
}
