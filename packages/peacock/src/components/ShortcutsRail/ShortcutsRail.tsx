import { Fragment, type HTMLAttributes } from "react";
import styles from "./ShortcutsRail.module.css";
import { Kbd } from "../Kbd/Kbd";

export interface Shortcut {
  keys: string[];
  label: string;
}

export interface ShortcutsRailProps extends HTMLAttributes<HTMLDivElement> {
  shortcuts: Shortcut[];
  /** Render a separator between items. Defaults to true. */
  separated?: boolean;
}

export function ShortcutsRail({
  shortcuts,
  separated = true,
  className,
  ...rest
}: ShortcutsRailProps) {
  return (
    <div className={[styles.rail, className].filter(Boolean).join(" ")} {...rest}>
      {shortcuts.map((s, i) => (
        <Fragment key={`${s.label}-${i}`}>
          <div className={styles.item}>
            <Kbd keys={s.keys} />
            <span>{s.label}</span>
          </div>
          {separated && i < shortcuts.length - 1 && <div className={styles.sep} />}
        </Fragment>
      ))}
    </div>
  );
}
