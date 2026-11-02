import { useRef, useState } from "react";
import { FilterIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { FilterChip } from "../FilterChip/FilterChip";
import {
  FilterMenu,
  type FilterMenuField,
  type FilterMenuOption,
} from "../FilterMenu/FilterMenu";
import styles from "./IssueFilterBar.module.css";

/** One active filter, already worded: "Priority" "is" "Urgent, High". */
export interface IssueFilterChipData {
  field: string;
  label: string;
  operator: string;
  value: string;
}

export interface IssueFilterBarProps {
  chips: IssueFilterChipData[];
  /** The Add filter menu's fields, in groups. */
  fields: FilterMenuField[][];
  onClear: () => void;
  /** "is" ↔ "is not". */
  onFlip: (field: string) => void;
  onRemove: (field: string) => void;
  onText: (field: string, text: string) => void;
  onToggle: (field: string, value: string) => void;
  /** Each option with how many of the unfiltered issues it would match. */
  optionsFor: (field: string) => FilterMenuOption[];
  selected: (field: string) => string[];
}

/** Linear's filter row: Filter, one chip per active filter, Clear. */
export function IssueFilterBar({
  chips,
  fields,
  onClear,
  onFlip,
  onRemove,
  onText,
  onToggle,
  optionsFor,
  selected,
}: IssueFilterBarProps) {
  const [menu, setMenu] = useState<{ field?: string } | null>(null);
  const anchor = useRef<HTMLDivElement>(null);

  return (
    <div ref={anchor} className={styles.bar}>
      <Button
        variant="ghost"
        size="sm"
        leading={<FilterIcon size={12} />}
        onClick={() => setMenu(menu ? null : {})}
      >
        Filter
      </Button>
      {chips.map((chip) => (
        <FilterChip
          key={chip.field}
          field={chip.label}
          operator={chip.operator}
          value={chip.value}
          onClick={() => setMenu({ field: chip.field })}
          onOperatorClick={() => onFlip(chip.field)}
          onRemove={() => onRemove(chip.field)}
        />
      ))}
      {chips.length > 0 && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      )}
      {menu && (
        <FilterMenu
          key={menu.field ?? "fields"}
          fields={fields}
          initialField={menu.field}
          optionsFor={optionsFor}
          selected={selected}
          triggerRef={anchor}
          onClose={() => setMenu(null)}
          onText={onText}
          onToggle={onToggle}
        />
      )}
    </div>
  );
}
