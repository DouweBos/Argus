import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  HoverCard,
  OptionMenu,
  type OptionMenuItem,
  PropertyButton,
} from "@argus/peacock";
import styles from "./IssuePropertyMenu.module.css";

interface IssuePropertyMenuProps {
  /** What hovering the button shows. */
  card: ReactNode;
  disabled?: boolean;
  /** The key that opens the menu from anywhere on the page. */
  hotkey: string;
  icon: ReactNode;
  items: OptionMenuItem[];
  label: string;
  onSelect: (value: string) => void;
  placeholder: string;
  selected: string;
}

function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/** One enum property: its value as a button, a menu to change it. */
export function IssuePropertyMenu({
  card,
  disabled,
  hotkey,
  icon,
  items,
  label,
  onSelect,
  placeholder,
  selected,
}: IssuePropertyMenuProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (disabled) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === hotkey.toLowerCase() &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !typing(e.target)
      ) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, hotkey]);

  return (
    <>
      <HoverCard
        disabled={open}
        card={
          <div className={styles.card}>
            {card}
            {!disabled && (
              <div className={styles.footer}>
                <span>{placeholder.replace("…", "")}</span>
                <span className={styles.key}>{hotkey}</span>
              </div>
            )}
          </div>
        }
      >
        <PropertyButton
          ref={ref}
          disabled={disabled}
          expanded={open}
          icon={icon}
          label={label}
          onClick={() => setOpen(true)}
        />
      </HoverCard>
      {open && (
        <OptionMenu
          hint={hotkey}
          items={items}
          placeholder={placeholder}
          selected={selected}
          triggerRef={ref}
          onClose={() => setOpen(false)}
          onSelect={onSelect}
        />
      )}
    </>
  );
}
