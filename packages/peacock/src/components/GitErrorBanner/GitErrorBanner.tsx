import {
  CloseIcon,
  CopyIcon,
  MergeIcon,
  RefreshIcon,
  WarningIcon,
} from "../../icons/Icons";
import styles from "./GitErrorBanner.module.css";

/**
 * Mirror of the backend `GitErrorKind` union — kept in sync manually so
 * Peacock stays isolated from app/electron code.
 */
export type GitErrorKind =
  | "auth-required"
  | "branch-checked-out"
  | "busy"
  | "cherry-pick-conflict"
  | "detached-head"
  | "dirty-working-tree"
  | "hook-failed"
  | "lfs-missing"
  | "lock-file-exists"
  | "merge-conflict"
  | "network-timeout"
  | "no-upstream"
  | "non-fast-forward"
  | "nothing-to-commit"
  | "nothing-to-pull"
  | "nothing-to-push"
  | "rebase-conflict"
  | "signing-failed"
  | "unknown";

/** Stable action ids consumers dispatch via `onAction`. */
export type GitErrorActionId =
  | "abort-cherry-pick"
  | "abort-merge"
  | "abort-rebase"
  | "configure-signing"
  | "continue-rebase"
  | "copy-stderr"
  | "discard"
  | "force-with-lease-confirm"
  | "force-with-lease"
  | "install-lfs"
  | "open-conflicts"
  | "open-keychain"
  | "publish-branch"
  | "pull-then-push"
  | "retry-without-hooks-confirm"
  | "retry-without-hooks"
  | "retry"
  | "stash-and-retry"
  | "use-ssh";

export interface GitErrorBannerProps {
  kind: GitErrorKind;
  message: string;
  recovery?: string;
  /**
   * Optional override for the displayed action set. Defaults to the
   * spec §7 mapping for the given `kind`.
   */
  actions?: GitErrorAction[];
  onAction?: (actionId: GitErrorActionId) => void;
  onDismiss?: () => void;
  /** Compact inline variant (used for transient `busy` retry notice). */
  variant?: "default" | "transient";
}

export interface GitErrorAction {
  id: GitErrorActionId;
  label: string;
  variant?: "danger" | "primary" | "secondary";
}

const TONE_BY_KIND: Record<GitErrorKind, "error" | "info" | "warning"> = {
  "auth-required": "error",
  "branch-checked-out": "warning",
  busy: "info",
  "cherry-pick-conflict": "warning",
  "detached-head": "warning",
  "dirty-working-tree": "warning",
  "hook-failed": "error",
  "lfs-missing": "warning",
  "lock-file-exists": "error",
  "merge-conflict": "warning",
  "network-timeout": "error",
  "no-upstream": "info",
  "non-fast-forward": "warning",
  "nothing-to-commit": "info",
  "nothing-to-pull": "info",
  "nothing-to-push": "info",
  "rebase-conflict": "warning",
  "signing-failed": "error",
  unknown: "error",
};

const DEFAULT_ACTIONS: Record<GitErrorKind, GitErrorAction[]> = {
  "no-upstream": [
    { id: "publish-branch", label: "Publish branch", variant: "primary" },
  ],
  "non-fast-forward": [
    { id: "pull-then-push", label: "Pull then push", variant: "primary" },
    {
      id: "force-with-lease",
      label: "Force-with-lease push",
      variant: "danger",
    },
  ],
  "auth-required": [
    { id: "open-keychain", label: "Open keychain" },
    { id: "use-ssh", label: "Use SSH" },
    { id: "retry", label: "Retry" },
  ],
  "merge-conflict": [
    { id: "open-conflicts", label: "Open conflicts", variant: "primary" },
    { id: "abort-merge", label: "Abort merge", variant: "danger" },
  ],
  "rebase-conflict": [
    { id: "open-conflicts", label: "Open conflicts", variant: "primary" },
    { id: "continue-rebase", label: "Continue" },
    { id: "abort-rebase", label: "Abort rebase", variant: "danger" },
  ],
  "cherry-pick-conflict": [
    { id: "open-conflicts", label: "Open conflicts", variant: "primary" },
    { id: "abort-cherry-pick", label: "Abort", variant: "danger" },
  ],
  "dirty-working-tree": [
    { id: "stash-and-retry", label: "Stash and retry", variant: "primary" },
    { id: "discard", label: "Discard changes", variant: "danger" },
  ],
  "detached-head": [{ id: "copy-stderr", label: "Copy details" }],
  "branch-checked-out": [{ id: "copy-stderr", label: "Copy details" }],
  "nothing-to-commit": [],
  "nothing-to-push": [],
  "nothing-to-pull": [],
  "lock-file-exists": [
    { id: "retry", label: "Retry", variant: "primary" },
    { id: "copy-stderr", label: "Copy details" },
  ],
  "lfs-missing": [
    { id: "install-lfs", label: "Install git-lfs", variant: "primary" },
    { id: "copy-stderr", label: "Copy details" },
  ],
  "signing-failed": [
    {
      id: "configure-signing",
      label: "Configure signing",
      variant: "primary",
    },
    { id: "copy-stderr", label: "Copy details" },
  ],
  "hook-failed": [
    { id: "retry", label: "Retry" },
    {
      id: "retry-without-hooks",
      label: "Retry without hooks",
      variant: "danger",
    },
    { id: "copy-stderr", label: "Copy stderr" },
  ],
  "network-timeout": [
    { id: "retry", label: "Retry", variant: "primary" },
    { id: "use-ssh", label: "Use SSH" },
  ],
  busy: [],
  unknown: [{ id: "copy-stderr", label: "Copy stderr" }],
};

function iconFor(kind: GitErrorKind) {
  switch (kind) {
    case "merge-conflict":
    case "rebase-conflict":
    case "cherry-pick-conflict":
      return <MergeIcon size={14} />;
    case "no-upstream":
    case "nothing-to-commit":
    case "nothing-to-push":
    case "nothing-to-pull":
    case "busy":
      return <RefreshIcon size={14} />;
    default:
      return <WarningIcon size={14} />;
  }
}

/**
 * Renders a typed git-error with kind-specific recovery affordances.
 * Use the `transient` variant for the `busy` auto-retry notice.
 */
export function GitErrorBanner({
  kind,
  message,
  recovery,
  actions,
  onAction,
  onDismiss,
  variant = "default",
}: GitErrorBannerProps) {
  const tone = TONE_BY_KIND[kind];
  const resolvedActions = actions ?? DEFAULT_ACTIONS[kind];

  if (variant === "transient") {
    return (
      <div
        className={[styles.banner, styles.transient, styles[tone]]
          .filter(Boolean)
          .join(" ")}
        role="status"
      >
        <span className={styles.spinner} aria-hidden="true" />
        <span className={styles.body}>
          <span className={styles.message}>{message}</span>
        </span>
        {onDismiss && (
          <button
            type="button"
            className={styles.dismiss}
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            <CloseIcon size={11} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={[styles.banner, styles[tone]].filter(Boolean).join(" ")}
      role={tone === "error" ? "alert" : "status"}
    >
      <span className={styles.icon}>{iconFor(kind)}</span>
      <div className={styles.body}>
        <span className={styles.message}>{message}</span>
        {recovery && <span className={styles.recovery}>{recovery}</span>}
        {resolvedActions.length > 0 && (
          <div className={styles.actions}>
            {resolvedActions.map((a) => (
              <button
                key={a.id}
                type="button"
                className={[
                  styles.actionBtn,
                  a.variant === "primary" ? styles.primary : "",
                  a.variant === "danger" ? styles.danger : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onAction?.(a.id)}
                title={a.label}
              >
                {a.id === "copy-stderr" && <CopyIcon size={11} />}
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          className={styles.dismiss}
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          <CloseIcon size={11} />
        </button>
      )}
    </div>
  );
}
