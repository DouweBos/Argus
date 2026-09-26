import type { ClaudeAccount } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import {
  AccountRow,
  Button,
  Input,
  SegmentedControl,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  SettingsScreenField,
} from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  addClaudeAccount,
  claudeAuthLoginCancel,
  claudeAuthLoginStart,
  claudeAuthLoginSubmitCode,
  listClaudeAccounts,
  openExternalUrl,
  removeClaudeAccount,
  renameClaudeAccount,
  setActiveClaudeAccount,
} from "../../../lib/ipc";
import styles from "./ClaudeAccountSection.module.css";

type LoginPhase =
  | "awaiting-browser"
  | "awaiting-code"
  | "idle"
  | "starting"
  | "submitting";
type AccountType = "claudeai" | "console";

const ACCOUNT_TYPE_OPTIONS = [
  { value: "claudeai" as const, label: "Claude subscription" },
  { value: "console" as const, label: "Anthropic Console" },
];

const SUBSCRIPTION_LABELS: Record<string, string> = {
  team: "Team",
  pro: "Pro",
  max: "Max",
  enterprise: "Enterprise",
  free: "Free",
};

function accountDisplayName(account: ClaudeAccount): string {
  return account.label || account.email || "Signing in…";
}

function planLabel(account: ClaudeAccount): string | undefined {
  if (!account.subscription_type) {
    return undefined;
  }

  return (
    SUBSCRIPTION_LABELS[account.subscription_type] ?? account.subscription_type
  );
}

/** Second line: org, plus the email when it isn't already the title. */
function accountDetail(account: ClaudeAccount): string | undefined {
  const parts = [
    account.label && account.email ? account.email : null,
    account.org_name,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function ClaudeAccountSection() {
  const [accounts, setAccounts] = useState<ClaudeAccount[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phase, setPhase] = useState<LoginPhase>("idle");
  const [accountType, setAccountType] = useState<AccountType>("claudeai");
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const refresh = useCallback(async () => {
    try {
      const state = await listClaudeAccounts();
      setAccounts(state.accounts);
      setActiveId(state.activeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useIpcEvent("claude-auth:accounts-changed", () => {
    refresh();
  });

  const resetLogin = () => {
    setPhase("idle");
    setLoginUrl(null);
    setCode("");
  };

  // Login completes over an OAuth loopback callback once the browser redirects;
  // the backend fires this when the CLI child exits. No code paste needed.
  useIpcEvent<{ error?: string; ok: boolean }>(
    "claude-auth:login-result",
    (payload) => {
      if (!payload.ok) {
        setError(payload.error ?? "Login failed.");
      }
      resetLogin();
      refresh();
    },
  );

  // Headless fallback: the CLI couldn't open a browser and is asking for a
  // pasted code, so reveal the input.
  useIpcEvent("claude-auth:login-needs-code", () => {
    setPhase((p) => (p === "awaiting-browser" ? "awaiting-code" : p));
  });

  /** Sign in an extra account, or re-authenticate `accountId` in place. */
  const startLogin = async (accountId?: string) => {
    setError(null);
    setPhase("starting");
    try {
      // The CLI opens the browser itself; we keep the URL for the manual
      // "Reopen sign-in page" fallback rather than opening a duplicate tab.
      const { url } = accountId
        ? await claudeAuthLoginStart(accountType === "console", accountId)
        : await addClaudeAccount(accountType === "console");
      setLoginUrl(url);
      setPhase("awaiting-browser");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      resetLogin();
    }
    refresh();
  };

  const submitCode = async () => {
    if (!code.trim()) {
      return;
    }
    setError(null);
    setPhase("submitting");
    try {
      const r = await claudeAuthLoginSubmitCode(code);
      if (r.ok) {
        resetLogin();
        await refresh();
      } else {
        setError(r.error ?? "Login failed.");
        setPhase("awaiting-code");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("awaiting-code");
    }
  };

  const cancelLogin = () => {
    claudeAuthLoginCancel().catch(() => {});
    setError(null);
    resetLogin();
    refresh();
  };

  /** Wrap a mutation so failures surface and the list always re-reads. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const empty = accounts.length === 0;

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Stay signed in to several Claude accounts at once and switch between them instantly — no logging out, no terminal."
        title="Claude account"
      />
      <SettingsScreenDetailBody>
        <SettingsScreenField
          label="Accounts"
          caption={
            empty
              ? undefined
              : "Agents and terminals use the selected account. Sessions pinned to another account keep theirs, and running agents are never interrupted by a switch. An account marked Signed out has expired credentials — sign in again to renew them. Limit reached means the plan's quota is spent: nothing to fix, it clears on its own."
          }
        >
          {empty ? (
            <p className={styles.muted}>No accounts signed in yet.</p>
          ) : (
            <div className={styles.list}>
              {accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  active={account.id === activeId}
                  busy={busy}
                  detail={accountDetail(account)}
                  label={accountDisplayName(account)}
                  needsReauth={account.needs_reauth}
                  plan={planLabel(account)}
                  rateLimited={account.rate_limited}
                  onReauth={() => startLogin(account.id)}
                  onRemove={() => run(() => removeClaudeAccount(account.id))}
                  onRename={(label) =>
                    run(() => renameClaudeAccount(account.id, label))
                  }
                  onSelect={() => run(() => setActiveClaudeAccount(account.id))}
                />
              ))}
            </div>
          )}
        </SettingsScreenField>

        {phase === "idle" ? (
          <SettingsScreenField
            label={empty ? "Sign in" : "Add another account"}
            caption="Opens your browser to authenticate — approve access there and Argus signs in automatically. Accounts already signed in stay signed in."
          >
            <div className={styles.loginStart}>
              <SegmentedControl<AccountType>
                aria-label="Account type"
                value={accountType}
                onChange={setAccountType}
                options={ACCOUNT_TYPE_OPTIONS}
              />
              <Button variant="primary" onClick={() => startLogin()}>
                {empty ? "Log in" : "Add account"}
              </Button>
            </div>
          </SettingsScreenField>
        ) : (
          <SettingsScreenField
            label="Complete sign-in"
            caption={
              phase === "awaiting-code"
                ? "Approve access in the browser, then paste the code shown there."
                : "A browser window should have opened. Approve access and this will finish on its own."
            }
          >
            <div className={styles.loginFlow}>
              {phase === "starting" ? (
                <p className={styles.muted}>Opening browser…</p>
              ) : (
                <>
                  {loginUrl && (
                    <button
                      type="button"
                      className={styles.urlLink}
                      onClick={() => openExternalUrl(loginUrl).catch(() => {})}
                    >
                      Reopen sign-in page
                    </button>
                  )}
                  {phase === "awaiting-browser" ? (
                    <>
                      <p className={styles.muted}>
                        Waiting for you to approve in your browser…
                      </p>
                      <div className={styles.loginActions}>
                        <Button variant="ghost" onClick={cancelLogin}>
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Input
                        autoFocus
                        placeholder="Paste authorization code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            submitCode().catch(() => {});
                          }
                        }}
                      />
                      <div className={styles.loginActions}>
                        <Button variant="ghost" onClick={cancelLogin}>
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          disabled={!code.trim() || phase === "submitting"}
                          onClick={submitCode}
                        >
                          {phase === "submitting" ? "Signing in…" : "Sign in"}
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </SettingsScreenField>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}
