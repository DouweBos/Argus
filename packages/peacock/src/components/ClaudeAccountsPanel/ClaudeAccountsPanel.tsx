import { useEffect, useState } from "react";
import { AccountRow } from "../AccountRow/AccountRow";
import { Banner } from "../Banner/Banner";
import { Button } from "../Button/Button";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { CopyField } from "../CopyField/CopyField";
import { Input } from "../Input/Input";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import { SettingsScreenField } from "../SettingsScreen/SettingsScreen";
import { Spinner } from "../Spinner/Spinner";
import styles from "./ClaudeAccountsPanel.module.css";

/** One account, from `claudeAccountRows` in `@argus/client-core`. */
export interface ClaudeAccountRowData {
  id: string;
  label: string;
  detail?: string;
  plan?: string;
  active: boolean;
  needsReauth: boolean;
  rateLimited: boolean;
}

export type ClaudeSignInStep =
  | "awaiting-browser"
  | "awaiting-code"
  | "idle"
  | "starting"
  | "submitting";

export type ClaudeAccountKind = "claudeai" | "console";

export interface ClaudeAccountsPanelProps {
  /** Null while the first list loads. */
  accounts: ClaudeAccountRowData[] | null;
  /** False hides every action: a monitor-only device can look, not change. */
  canManage?: boolean;
  /** A mutation is in flight. */
  busy?: boolean;
  error?: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onRemove: (id: string) => void;
  onReauth: (id: string) => void;

  step: ClaudeSignInStep;
  accountKind: ClaudeAccountKind;
  onAccountKindChange: (kind: ClaudeAccountKind) => void;
  onStartSignIn: () => void;
  onCancelSignIn: () => void;
  onSubmitCode: (code: string) => void;
  /**
   * `computer` when this screen is a remote client: the browser opens on the
   * computer, so the code field is offered from the start rather than only
   * once the CLI asks for it.
   */
  browserOn?: "computer" | "here";
  /** The sign-in page, to reopen (here) or read and copy (computer). */
  loginUrl?: string | null;
  onOpenLoginUrl?: () => void;
  /** How the last attempt ended. */
  outcome?: { ok: false; error: string } | { ok: true } | null;
}

const KIND_OPTIONS = [
  { value: "claudeai" as const, label: "Claude subscription" },
  { value: "console" as const, label: "Anthropic Console" },
];

const ACCOUNTS_CAPTION =
  "Agents and terminals use the selected account. Sessions pinned to another account keep theirs, and running agents are never interrupted by a switch. An account marked Signed out has expired credentials — sign in again to renew them. Limit reached means the plan's quota is spent: nothing to fix, it clears on its own.";

function waitingText(step: ClaudeSignInStep, remote: boolean): string {
  if (step === "awaiting-code") {
    return "Claude is waiting for the code the browser shows.";
  }

  return remote
    ? "Waiting for you to approve in the browser on your computer…"
    : "Waiting for you to approve in your browser…";
}

function pendingCaption(step: ClaudeSignInStep, remote: boolean): string {
  if (remote) {
    return "Finish on your computer, or paste the code the browser shows there.";
  }

  return step === "awaiting-code"
    ? "Approve access in the browser, then paste the code shown there."
    : "A browser window should have opened. Approve access and this will finish on its own.";
}

function AccountList({
  accounts,
  busy,
  canManage,
  onReauth,
  onRemove,
  onRename,
  onSelect,
}: Pick<
  ClaudeAccountsPanelProps,
  "busy" | "canManage" | "onReauth" | "onRename" | "onSelect"
> & {
  accounts: ClaudeAccountRowData[] | null;
  onRemove: (account: ClaudeAccountRowData) => void;
}) {
  if (accounts === null) {
    return (
      <p className={styles.muted}>
        <Spinner size="sm" />
        Loading accounts…
      </p>
    );
  }
  if (accounts.length === 0) {
    return <p className={styles.muted}>No accounts signed in yet.</p>;
  }

  return (
    <div className={styles.list}>
      {accounts.map((account) => (
        <AccountRow
          key={account.id}
          active={account.active}
          busy={busy}
          detail={account.detail}
          label={account.label}
          needsReauth={account.needsReauth}
          plan={account.plan}
          rateLimited={account.rateLimited}
          onReauth={canManage ? () => onReauth(account.id) : undefined}
          onRemove={canManage ? () => onRemove(account) : undefined}
          onRename={
            canManage ? (label) => onRename(account.id, label) : undefined
          }
          onSelect={canManage ? () => onSelect(account.id) : undefined}
        />
      ))}
    </div>
  );
}

function SignInFlow({
  step,
  browserOn,
  loginUrl,
  onOpenLoginUrl,
  onCancelSignIn,
  onSubmitCode,
}: Pick<
  ClaudeAccountsPanelProps,
  | "browserOn"
  | "loginUrl"
  | "onCancelSignIn"
  | "onOpenLoginUrl"
  | "onSubmitCode"
  | "step"
>) {
  const [code, setCode] = useState("");
  const remote = browserOn === "computer";
  const showCode = step === "awaiting-code" || step === "submitting" || remote;

  useEffect(() => {
    if (step === "idle") {
      setCode("");
    }
  }, [step]);

  if (step === "starting") {
    return (
      <p className={styles.muted}>
        <Spinner size="sm" />
        {remote ? "Opening the browser on your computer…" : "Opening browser…"}
      </p>
    );
  }
  const submit = () => {
    if (code.trim() && step !== "submitting") {
      onSubmitCode(code.trim());
    }
  };

  return (
    <div className={styles.flow}>
      {loginUrl &&
        (remote ? (
          <CopyField copyLabel="Copy link" value={loginUrl} />
        ) : (
          onOpenLoginUrl && (
            <button
              type="button"
              className={styles.urlLink}
              onClick={onOpenLoginUrl}
            >
              Reopen sign-in page
            </button>
          )
        ))}
      <p className={styles.muted}>{waitingText(step, remote)}</p>
      {showCode && (
        <Input
          autoFocus={step === "awaiting-code"}
          aria-label="Authorization code"
          placeholder="Paste the code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              submit();
            }
          }}
        />
      )}
      <div className={styles.actions}>
        <Button variant="ghost" onClick={onCancelSignIn}>
          Cancel
        </Button>
        {showCode && (
          <Button
            variant="primary"
            disabled={!code.trim() || step === "submitting"}
            onClick={submit}
          >
            {step === "submitting" ? "Signing in…" : "Sign in"}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Every Claude account signed in on a computer, which one new agents run as,
 * and signing another in (or one in again) without leaving the list.
 */
export function ClaudeAccountsPanel({
  accounts,
  canManage = true,
  busy = false,
  error,
  onSelect,
  onRename,
  onRemove,
  onReauth,
  step,
  accountKind,
  onAccountKindChange,
  onStartSignIn,
  onCancelSignIn,
  onSubmitCode,
  browserOn = "here",
  loginUrl,
  onOpenLoginUrl,
  outcome,
}: ClaudeAccountsPanelProps) {
  const [removing, setRemoving] = useState<ClaudeAccountRowData | null>(null);
  const empty = accounts !== null && accounts.length === 0;
  const remote = browserOn === "computer";

  return (
    <>
      <SettingsScreenField
        label="Accounts"
        caption={accounts && !empty ? ACCOUNTS_CAPTION : undefined}
      >
        <AccountList
          accounts={accounts}
          busy={busy}
          canManage={canManage}
          onReauth={onReauth}
          onRemove={setRemoving}
          onRename={onRename}
          onSelect={onSelect}
        />
      </SettingsScreenField>

      {canManage &&
        (step === "idle" ? (
          <SettingsScreenField
            label={empty ? "Sign in" : "Add another account"}
            caption={
              remote
                ? "A browser opens on your computer to approve access. Finish there, or paste the code it shows here. Accounts already signed in stay signed in."
                : "Opens your browser to authenticate — approve access there and Argus signs in automatically. Accounts already signed in stay signed in."
            }
          >
            <div className={styles.start}>
              {outcome?.ok === true && (
                <Banner tone="success">Signed in.</Banner>
              )}
              {outcome?.ok === false && (
                <Banner tone="error">{outcome.error}</Banner>
              )}
              <SegmentedControl<ClaudeAccountKind>
                aria-label="Account type"
                value={accountKind}
                onChange={onAccountKindChange}
                options={KIND_OPTIONS}
              />
              <Button variant="primary" onClick={onStartSignIn}>
                {empty ? "Sign in" : "Add account"}
              </Button>
            </div>
          </SettingsScreenField>
        ) : (
          <SettingsScreenField
            label="Complete sign-in"
            caption={pendingCaption(step, remote)}
          >
            <SignInFlow
              browserOn={browserOn}
              loginUrl={loginUrl}
              step={step}
              onCancelSignIn={onCancelSignIn}
              onOpenLoginUrl={onOpenLoginUrl}
              onSubmitCode={onSubmitCode}
            />
          </SettingsScreenField>
        ))}

      {error && <p className={styles.error}>{error}</p>}

      {removing && (
        <ConfirmDialog
          destructive
          confirmLabel="Remove"
          title={`Remove ${removing.label}?`}
          titleId="claude-account-remove"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            onRemove(removing.id);
            setRemoving(null);
          }}
        >
          This clears the account from Argus; Claude's own credentials are
          untouched.
        </ConfirmDialog>
      )}
    </>
  );
}
