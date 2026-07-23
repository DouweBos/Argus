import type { RegisteredRunner } from "../../../lib/types";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useOutsideClick } from "../../../hooks/useOutsideClick";
import styles from "./ModelPicker.module.css";

export interface ModelOption {
  /** Optional short description shown below the name. */
  description?: string;
  /** Display label shown in the picker. */
  displayName: string;
  /** The model identifier sent to the CLI (e.g. "claude-opus-4-6"). */
  value: string;
}

/**
 * Runner state surfaced at the top of the picker.
 *
 * - `locked: true` (existing session): the runner is read-only — Resolved
 *   Decision 4 of the LLM-routing plan pins runner at session creation.
 * - `locked: false` + `available` provided: the user can switch between
 *   registered runners. Today only `claude-code` is registered, so the
 *   list collapses to a single non-interactive entry.
 */
export interface RunnerSelection {
  /** Registered runners surfaced as choices. Required when `locked` is false. */
  available?: RegisteredRunner[];
  /** Currently bound or proposed runner id. */
  currentId: string;
  /** When true, the runner is fixed for this session and cannot change. */
  locked: boolean;
  /** Callback fired when a different runner is picked (only when not locked). */
  onSelect?: (runnerId: string) => void;
}

/**
 * Claude accounts surfaced above the runner. Pinning a session to an account
 * lets sessions run in parallel on different accounts; `null` follows the
 * app-wide active account picked in Settings.
 */
export interface AccountSelection {
  /** Account the app falls back to when nothing is pinned. */
  activeId: string | null;
  /** Accounts available to pin to. */
  available: AccountOption[];
  /** Currently pinned account, or null when following the app default. */
  currentId: string | null;
  onSelect: (accountId: string | null) => void;
}

export interface AccountOption {
  /** Optional second line, e.g. the organization or plan. */
  description?: string;
  displayName: string;
  id: string;
}

interface ModelPickerProps {
  /** Account section rendered above the runner. Omit to hide it. */
  account?: AccountSelection;
  currentModel: string | undefined;
  models: ModelOption[];
  onClose: () => void;
  onSelect: (modelValue: string) => void;
  /**
   * Runner displayed above the model list. When omitted, the picker behaves
   * like a model-only switcher (legacy callers).
   */
  runner?: RunnerSelection;
  /** Element the picker should anchor to. Picker opens above and aligned to its left. */
  triggerRef: RefObject<HTMLElement | null>;
}

interface PickerRect {
  bottom: number;
  left: number;
}

export function ModelPicker({
  models,
  currentModel,
  onSelect,
  onClose,
  account,
  runner,
  triggerRef,
}: ModelPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<PickerRect | null>(null);

  useLayoutEffect(() => {
    const updateRect = () => {
      const node = triggerRef.current;
      if (!node) {
        return;
      }
      const r = node.getBoundingClientRect();
      setRect({ left: r.left, bottom: window.innerHeight - r.top + 6 });
    };

    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [triggerRef]);

  useOutsideClick(ref, true, onClose, (target) => {
    return triggerRef.current?.contains(target) ?? false;
  });

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleEscape);

    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  if (!rect) {
    return null;
  }

  return createPortal(
    <div
      ref={ref}
      className={styles.picker}
      style={{ left: rect.left, bottom: rect.bottom }}
    >
      {account && account.available.length > 0 && (
        <AccountSection account={account} />
      )}
      {runner && <RunnerSection runner={runner} />}

      <div className={styles.header}>Switch model</div>
      {models.map((model) => {
        const isActive = model.value === currentModel;

        return (
          <button
            key={model.value}
            className={`${styles.option} ${isActive ? styles.optionActive : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(model.value);
            }}
          >
            <div className={styles.optionLabel}>
              <span className={styles.optionName}>{model.displayName}</span>
              {model.description && (
                <span className={styles.optionDesc}>{model.description}</span>
              )}
            </div>
            {isActive && <span className={styles.optionCheck}>✓</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

function AccountSection({ account }: { account: AccountSelection }) {
  const followLabel =
    account.available.find((a) => a.id === account.activeId)?.displayName ??
    "app default";

  const options: { description?: string; id: string | null; name: string }[] = [
    {
      id: null,
      name: "Follow app default",
      description: followLabel,
    },
    ...account.available.map((a) => ({
      id: a.id,
      name: a.displayName,
      description: a.description,
    })),
  ];

  return (
    <>
      <div className={styles.header}>Account</div>
      {options.map((opt) => {
        const isActive = opt.id === account.currentId;

        return (
          <button
            key={opt.id ?? "default"}
            className={`${styles.option} ${isActive ? styles.optionActive : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              account.onSelect(opt.id);
            }}
          >
            <div className={styles.optionLabel}>
              <span className={styles.optionName}>{opt.name}</span>
              {opt.description && (
                <span className={styles.optionDesc}>{opt.description}</span>
              )}
            </div>
            {isActive && <span className={styles.optionCheck}>✓</span>}
          </button>
        );
      })}
    </>
  );
}

function RunnerSection({ runner }: { runner: RunnerSelection }) {
  const available = runner.available ?? [];
  const current =
    available.find((r) => r.id === runner.currentId) ??
    fallbackRunner(runner.currentId);

  // Locked (existing session) or only one registered runner: render a
  // single read-only row. Resolved Decision 4 forbids changing the runner
  // on an existing session.
  const selectable = !runner.locked && available.length > 1;

  if (!selectable) {
    return (
      <>
        <div className={styles.header}>Runner</div>
        <div className={styles.runnerStatic} aria-label="Runner">
          <div className={styles.optionLabel}>
            <span className={styles.optionName}>{current.displayName}</span>
            {runner.locked && (
              <span className={styles.optionDesc}>Fixed for this session</span>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.header}>Runner</div>
      {available.map((opt) => {
        const isActive = opt.id === runner.currentId;

        return (
          <button
            key={opt.id}
            className={`${styles.option} ${isActive ? styles.optionActive : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              runner.onSelect?.(opt.id);
            }}
          >
            <div className={styles.optionLabel}>
              <span className={styles.optionName}>{opt.displayName}</span>
            </div>
            {isActive && <span className={styles.optionCheck}>✓</span>}
          </button>
        );
      })}
    </>
  );
}

function fallbackRunner(id: string): { displayName: string; id: string } {
  // Render an id-derived label when the registry hasn't been read yet.
  // The displayName is replaced as soon as `list_runners` returns.
  return { id, displayName: id };
}
