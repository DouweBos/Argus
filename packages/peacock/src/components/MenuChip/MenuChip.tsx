import { type ReactNode, useRef, useState } from "react";
import { ChevronDownIcon } from "../../icons/Icons";
import { Chip } from "../Chip/Chip";
import { PickerPopover } from "../PickerPopover/PickerPopover";
import styles from "./MenuChip.module.css";

export interface MenuChipOption<V extends string = string> {
  value: V;
  label: string;
  /** A second line under the label in the menu. */
  hint?: string;
  /** Listed but not pickable; `hint` says why. */
  disabled?: boolean;
}

export interface MenuChipProps<V extends string = string> {
  /** What it picks: the menu's header, and the chip's prefix with `showsTitle`. */
  title: string;
  value: V;
  options: MenuChipOption<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
  leading?: ReactNode;
  mono?: boolean;
  /** "Runner: Default", where nothing else says what the chip picks. */
  showsTitle?: boolean;
}

/**
 * A chip showing the current choice that opens a menu to change it: the
 * in-place pick, rather than a picker on its own screen. The web twin of
 * ArgusUI's `MenuChip`.
 */
export function MenuChip<V extends string = string>({
  disabled,
  leading,
  mono,
  onChange,
  options,
  showsTitle,
  title,
  value,
}: MenuChipProps<V>) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const current = options.find((o) => o.value === value)?.label ?? value;

  return (
    <span className={styles.anchor} ref={anchor}>
      <Chip
        aria-disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={disabled ? styles.disabled : undefined}
        interactive={!disabled}
        leading={leading}
        mono={mono}
        role="button"
        tabIndex={disabled ? -1 : 0}
        title={title}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        {showsTitle && <span className={styles.title}>{title}:</span>}
        <span>{current}</span>
        <ChevronDownIcon size={9} />
      </Chip>
      {open && (
        <PickerPopover
          placement="below"
          triggerRef={anchor}
          width={260}
          onClose={() => setOpen(false)}
        >
          <PickerPopover.Header>{title}</PickerPopover.Header>
          {options.map((option) => (
            <PickerPopover.Option
              description={option.hint}
              disabled={option.disabled}
              key={option.value}
              name={option.label}
              selected={option.value === value}
              onSelect={() => {
                setOpen(false);
                onChange(option.value);
              }}
            />
          ))}
        </PickerPopover>
      )}
    </span>
  );
}
