import { type ReactNode, useRef, useState } from "react";
import { Chip } from "../Chip/Chip";
import { PickerPopover } from "../PickerPopover/PickerPopover";
import styles from "./StartComposer.module.css";

export interface PickerChipOption {
  value: string;
  name: string;
  description?: string;
  /** Listed but not pickable; `description` says why. */
  disabled?: boolean;
}

export interface PickerChipProps {
  /** What the chip reads. */
  label: ReactNode;
  /** Tooltip and accessible name. */
  title: string;
  header?: string;
  options: PickerChipOption[];
  /** The values shown as picked. */
  selected: string[];
  onSelect: (value: string) => void;
  /** Keep the list open after a pick, for multi-select. */
  multiple?: boolean;
  /** Shown when there are no options. */
  empty?: string;
  leading?: ReactNode;
  mono?: boolean;
  muted?: boolean;
  /** Called when the list opens, e.g. to refresh its options. */
  onOpen?: () => void;
  placement?: "above" | "below";
}

/** A chip that opens a list to pick from: model, mode, effort, project. */
export function PickerChip({
  label,
  title,
  header,
  options,
  selected,
  onSelect,
  multiple = false,
  empty = "Nothing to pick",
  leading,
  mono,
  muted,
  onOpen,
  placement,
}: PickerChipProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={anchorRef} className={styles.chipAnchor}>
      <Chip
        interactive
        aria-label={title}
        leading={leading}
        mono={mono}
        muted={muted}
        title={title}
        onClick={() => {
          if (!open) {
            onOpen?.();
          }
          setOpen((o) => !o);
        }}
      >
        {label}
      </Chip>
      {open && (
        <PickerPopover
          placement={placement}
          triggerRef={anchorRef}
          onClose={() => setOpen(false)}
        >
          {header && <PickerPopover.Header>{header}</PickerPopover.Header>}
          {options.length === 0 ? (
            <PickerPopover.Empty>{empty}</PickerPopover.Empty>
          ) : (
            options.map((o) => (
              <PickerPopover.Option
                key={o.value}
                description={o.description}
                disabled={o.disabled}
                name={o.name}
                selected={selected.includes(o.value)}
                onSelect={() => {
                  if (!multiple) {
                    setOpen(false);
                  }
                  onSelect(o.value);
                }}
              />
            ))
          )}
        </PickerPopover>
      )}
    </div>
  );
}
