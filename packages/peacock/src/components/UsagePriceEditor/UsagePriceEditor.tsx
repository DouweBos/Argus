import { useState } from "react";
import {
  ArrowBackIcon,
  PlusIcon,
  UndoIcon,
  WarningIcon,
} from "../../icons/Icons";
import { Button } from "../Button/Button";
import { EmptyState } from "../EmptyState/EmptyState";
import { Input } from "../Input/Input";
import { Spinner } from "../Spinner/Spinner";
import styles from "./UsagePriceEditor.module.css";

export type UsagePriceField = "cacheRead" | "cacheWrite" | "input" | "output";

const FIELDS: { field: UsagePriceField; label: string }[] = [
  { field: "input", label: "Input" },
  { field: "output", label: "Output" },
  { field: "cacheRead", label: "Cache read" },
  { field: "cacheWrite", label: "Cache write" },
];

/** One model's prices as typed, from the draft in `@argus/client-core`. */
export interface UsagePriceRowData {
  model: string;
  values: Record<UsagePriceField, string>;
  /** The list price, or what an empty field falls back to. */
  placeholders: Record<UsagePriceField, string>;
  mapTo: string;
  /** Saved as a price set by hand. */
  custom: boolean;
  /** Goes back to automatic on save; undoable until then. */
  reset: boolean;
  /** "Reset to automatic" has something to undo. */
  resettable: boolean;
}

export interface UsagePriceEditorProps {
  rows: UsagePriceRowData[];
  /** Before the first answer. */
  loading: boolean;
  /** Couldn't read the prices at all. */
  loadError: string | null;
  onRetry: () => void;
  /** The host refused the save, in its words. */
  error: string | null;
  saving: boolean;
  dirty: boolean;
  /** Read-only: this device can't change prices. */
  disabled: boolean;
  onChange: (
    model: string,
    field: UsagePriceField | "mapTo",
    value: string,
  ) => void;
  onReset: (model: string) => void;
  onUndo: (model: string) => void;
  onAdd: (model: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** Model prices set by hand: per million tokens, or counted as another model. */
export function UsagePriceEditor({
  rows,
  loading,
  loadError,
  onRetry,
  error,
  saving,
  dirty,
  disabled,
  onChange,
  onReset,
  onUndo,
  onAdd,
  onSave,
  onCancel,
}: UsagePriceEditorProps) {
  const [adding, setAdding] = useState("");
  const add = () => {
    if (adding.trim()) {
      onAdd(adding.trim());
      setAdding("");
    }
  };
  const locked = disabled || saving;
  let status = null;
  if (loading && rows.length === 0) {
    status = (
      <div className={styles.loading}>
        <Spinner />
      </div>
    );
  } else if (loadError && rows.length === 0) {
    status = (
      <EmptyState
        action={
          <Button onClick={onRetry} size="sm">
            Try again
          </Button>
        }
        body={loadError}
        icon={<WarningIcon size={18} />}
        title="Couldn't load model prices"
      />
    );
  }

  return (
    <div className={styles.editor}>
      <header className={styles.head}>
        <Button
          leading={<ArrowBackIcon size={12} />}
          onClick={onCancel}
          size="sm"
          variant="ghost"
        >
          Usage
        </Button>
        <h1 className={styles.title}>Model prices</h1>
        <p className={styles.caption}>
          US dollars per million tokens, used for every cost estimate on this
          computer. Empty fields use the list price; empty cache prices use the
          input price. Map a model to count it as another one.
        </p>
        {disabled && (
          <p className={styles.caption}>
            This device can only view prices. Changing them needs control
            access.
          </p>
        )}
      </header>

      {status ?? (
        <>
          <form
            className={styles.add}
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Input
              aria-label="Model id"
              disabled={locked}
              mono
              placeholder="Add a model id, e.g. gpt-5.1-codex"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
            />
            <Button
              disabled={locked || !adding.trim()}
              leading={<PlusIcon size={12} />}
              size="sm"
              type="submit"
              variant="secondary"
            >
              Add model
            </Button>
          </form>

          <div className={styles.table} role="table">
            <div className={`${styles.row} ${styles.headRow}`} role="row">
              <span role="columnheader">Model</span>
              {FIELDS.map((f) => (
                <span className={styles.num} key={f.field} role="columnheader">
                  {f.label}
                </span>
              ))}
              <span role="columnheader">Map to</span>
              <span role="columnheader" />
            </div>
            {rows.length === 0 && (
              <p className={styles.empty}>
                No models yet. Add one to price it by hand.
              </p>
            )}
            {rows.map((row) => {
              const mapped = row.mapTo.trim() !== "";

              return (
                <div
                  className={[styles.row, row.reset ? styles.resetRow : ""]
                    .filter(Boolean)
                    .join(" ")}
                  key={row.model}
                  role="row"
                >
                  <span className={styles.model} role="cell">
                    <span className={styles.modelId}>{row.model}</span>
                    {row.reset ? (
                      <span className={styles.tag}>Automatic on save</span>
                    ) : (
                      row.custom && <span className={styles.tag}>Custom</span>
                    )}
                  </span>
                  {FIELDS.map((f) => (
                    <span key={f.field} role="cell">
                      <Input
                        aria-label={`${row.model} ${f.label} per million tokens`}
                        className={styles.num}
                        disabled={locked || row.reset || mapped}
                        inputMode="decimal"
                        mono
                        placeholder={mapped ? "—" : row.placeholders[f.field]}
                        value={mapped ? "" : row.values[f.field]}
                        onChange={(e) =>
                          onChange(row.model, f.field, e.target.value)
                        }
                      />
                    </span>
                  ))}
                  <span role="cell">
                    <Input
                      aria-label={`Count ${row.model} as`}
                      disabled={locked || row.reset}
                      mono
                      placeholder="Model id"
                      value={row.mapTo}
                      onChange={(e) =>
                        onChange(row.model, "mapTo", e.target.value)
                      }
                    />
                  </span>
                  <span className={styles.action} role="cell">
                    {row.reset ? (
                      <Button
                        disabled={locked}
                        leading={<UndoIcon size={12} />}
                        onClick={() => onUndo(row.model)}
                        size="sm"
                        variant="ghost"
                      >
                        Undo
                      </Button>
                    ) : (
                      row.resettable && (
                        <Button
                          disabled={locked}
                          onClick={() => onReset(row.model)}
                          size="sm"
                          variant="ghost"
                        >
                          Reset to automatic
                        </Button>
                      )
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <footer className={styles.footer}>
        {error && <p className={styles.error}>{error}</p>}
        <span className={styles.spacer} />
        <Button disabled={saving} onClick={onCancel} variant="ghost">
          Cancel
        </Button>
        <Button disabled={locked || !dirty} onClick={onSave}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </footer>
    </div>
  );
}
