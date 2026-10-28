import { type RefObject, useState } from "react";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "../../icons/Icons";
import { Input } from "../Input/Input";
import { PickerPopover } from "../PickerPopover/PickerPopover";
import styles from "./FilterMenu.module.css";

export interface FilterMenuField {
  id: string;
  label: string;
  /** `text` asks for free text instead of offering options. */
  kind?: "options" | "text";
}

export interface FilterMenuOption {
  count?: number;
  label: string;
  value: string;
}

export interface FilterMenuProps {
  /** Fields in groups; a divider separates the groups. */
  fields: FilterMenuField[][];
  /** Opens straight on this field's options instead of the field list. */
  initialField?: string;
  onClose: () => void;
  /** Free text for a `text` field; empty clears it. */
  onText: (fieldId: string, text: string) => void;
  onToggle: (fieldId: string, value: string) => void;
  optionsFor: (fieldId: string) => FilterMenuOption[];
  selected: (fieldId: string) => string[];
  triggerRef: RefObject<HTMLElement | null>;
}

/** Linear's "Add filter…": pick a field, then tick the values it should match. */
export function FilterMenu({
  fields,
  initialField,
  onClose,
  onText,
  onToggle,
  optionsFor,
  selected,
  triggerRef,
}: FilterMenuProps) {
  const [fieldId, setFieldId] = useState<string | null>(initialField ?? null);
  const [query, setQuery] = useState("");
  const field = fields.flat().find((f) => f.id === fieldId) ?? null;
  const needle = query.trim().toLowerCase();
  let placeholder = "Add filter…";
  if (field) {
    placeholder =
      field.kind === "text" ? `${field.label} contains…` : `${field.label}…`;
  }

  const open = (id: string) => {
    setFieldId(id);
    setQuery("");
  };

  return (
    <PickerPopover triggerRef={triggerRef} onClose={onClose}>
      <div className={styles.search}>
        {field && (
          <button
            aria-label="Back to fields"
            className={styles.back}
            type="button"
            onClick={() => open("")}
          >
            <ChevronLeftIcon size={10} />
          </button>
        )}
        <Input
          autoFocus
          bare
          aria-label={field ? `Filter ${field.label}` : "Add filter"}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && field?.kind === "text") {
              onText(field.id, query.trim());
              onClose();
            }
          }}
        />
      </div>

      {!field &&
        fields.map((group, i) => {
          const shown = group.filter((f) =>
            f.label.toLowerCase().includes(needle),
          );

          return shown.length === 0 ? null : (
            <div key={i} className={styles.group}>
              {shown.map((f) => (
                <button
                  key={f.id}
                  className={styles.row}
                  type="button"
                  onClick={() => open(f.id)}
                >
                  <span className={styles.label}>{f.label}</span>
                  <ChevronRightIcon size={10} />
                </button>
              ))}
            </div>
          );
        })}

      {field?.kind === "text" && (
        <p className={styles.hint}>Press Enter to filter on this text.</p>
      )}

      {field && field.kind !== "text" && (
        <div className={styles.group}>
          {optionsFor(field.id)
            .filter((o) => o.label.toLowerCase().includes(needle))
            .map((option) => {
              const checked = selected(field.id).includes(option.value);

              return (
                <button
                  key={option.value}
                  aria-pressed={checked}
                  className={styles.row}
                  type="button"
                  onClick={() => onToggle(field.id, option.value)}
                >
                  <span className={checked ? styles.boxOn : styles.box}>
                    {checked && <CheckIcon size={9} />}
                  </span>
                  <span className={styles.label}>{option.label}</span>
                  {option.count != null && (
                    <span className={styles.count}>{option.count}</span>
                  )}
                </button>
              );
            })}
        </div>
      )}
    </PickerPopover>
  );
}
