import { useState } from "react";
import { ColorSwatch } from "@argus/peacock";
import styles from "./NodeMetadataPanel.module.css";
import { setNodeProperty } from "./store";

/**
 * Live-edit controls for `conductor native-set`'s whitelisted properties. Each
 * keeps a local draft (so typing is smooth) synced to the authoritative value,
 * and commits on Enter / blur / toggle — after which the store re-inspects and
 * the draft re-syncs to whatever the device reports.
 */

interface EditorBase {
  deviceKey: string | null;
  nodeId: string;
  /** native-set key, e.g. "text", "backgroundColor", "alpha". */
  propKey: string;
}

/**
 * Editable draft that re-syncs to the authoritative value when it (or the
 * selected node) changes — React's "adjust state during render" pattern, so no
 * effect is needed and typing isn't clobbered mid-edit.
 */
function useDraft<T>(
  value: T,
  nodeId: string,
): [T, (v: T) => void, () => void] {
  const [draft, setDraft] = useState<T>(value);
  const [sync, setSync] = useState({ nodeId, value });
  if (sync.value !== value || sync.nodeId !== nodeId) {
    setSync({ nodeId, value });
    setDraft(value);
  }

  return [draft, setDraft, () => setDraft(value)];
}

export function TextEdit({
  deviceKey,
  nodeId,
  propKey,
  value,
}: EditorBase & { value: string }) {
  const [draft, setDraft, reset] = useDraft(value, nodeId);

  const commit = () => {
    if (draft !== value) {
      setNodeProperty(deviceKey, nodeId, propKey, draft).catch(() => {});
    }
  };

  return (
    <input
      className={styles.textInput}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          reset();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function NumberEdit({
  deviceKey,
  nodeId,
  propKey,
  value,
  step = 1,
  min,
  max,
}: EditorBase & { max?: number; min?: number; step?: number; value: number }) {
  const [draft, setDraft, reset] = useDraft(String(value), nodeId);

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || String(value) === draft) {
      reset();

      return;
    }
    setNodeProperty(deviceKey, nodeId, propKey, String(n)).catch(() => {});
  };

  return (
    <input
      className={styles.numberInput}
      type="number"
      value={draft}
      step={step}
      min={min}
      max={max}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          reset();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** "#RRGGBBAA" → "#RRGGBB" for the native color input. */
function rgbOf(hex: string): string {
  const h = hex.replace("#", "");

  return `#${h.slice(0, 6).padEnd(6, "0")}`;
}

/** Trailing alpha byte, defaulting to fully opaque. */
function alphaOf(hex: string): string {
  const h = hex.replace("#", "");

  return h.length >= 8 ? h.slice(6, 8) : "FF";
}

export function ColorEdit({
  deviceKey,
  nodeId,
  propKey,
  value,
}: EditorBase & { value: string }) {
  const [draft, setDraft, reset] = useDraft(value, nodeId);

  const commit = (next: string) => {
    if (next !== value) {
      setNodeProperty(deviceKey, nodeId, propKey, next).catch(() => {});
    }
  };

  return (
    <span className={styles.colorEdit}>
      <input
        className={styles.colorPicker}
        type="color"
        value={rgbOf(draft)}
        // Keep the existing alpha; the native picker only edits RGB.
        onChange={(e) => setDraft(`${e.target.value}${alphaOf(draft)}`)}
        onBlur={() => commit(draft)}
        aria-label={`${propKey} color`}
      />
      <input
        className={styles.hexInput}
        type="text"
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft.startsWith("#") ? draft : `#${draft}`)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            reset();
            e.currentTarget.blur();
          }
        }}
      />
      <ColorSwatch color={draft} showValue={false} />
    </span>
  );
}

export function BoolEdit({
  deviceKey,
  nodeId,
  propKey,
  value,
}: EditorBase & { value: boolean }) {
  return (
    <input
      className={styles.toggle}
      type="checkbox"
      checked={value}
      onChange={(e) => {
        setNodeProperty(
          deviceKey,
          nodeId,
          propKey,
          e.target.checked ? "true" : "false",
        ).catch(() => {});
      }}
    />
  );
}
