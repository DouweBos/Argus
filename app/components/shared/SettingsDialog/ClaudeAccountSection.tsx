import type { ClaudeAccount } from "../../../lib/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { claudeAccountRows } from "@argus/client-core";
import {
  type ClaudeAccountKind,
  ClaudeAccountsPanel,
  type ClaudeSignInStep,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
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

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function ClaudeAccountSection() {
  const [accounts, setAccounts] = useState<ClaudeAccount[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<ClaudeSignInStep>("idle");
  const [accountKind, setAccountKind] = useState<ClaudeAccountKind>("claudeai");
  const [loginUrl, setLoginUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const state = await listClaudeAccounts();
      setAccounts(state.accounts);
      setActiveId(state.activeId);
    } catch (e) {
      setAccounts((a) => a ?? []);
      setError(message(e));
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useIpcEvent("claude-auth:accounts-changed", () => {
    refresh().catch(() => {});
  });

  const resetLogin = () => {
    setStep("idle");
    setLoginUrl(null);
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
      refresh().catch(() => {});
    },
  );

  // Headless fallback: the CLI couldn't open a browser and is asking for a
  // pasted code, so reveal the input.
  useIpcEvent("claude-auth:login-needs-code", () => {
    setStep((p) => (p === "awaiting-browser" ? "awaiting-code" : p));
  });

  /** Sign in an extra account, or re-authenticate `accountId` in place. */
  const startLogin = async (accountId?: string) => {
    setError(null);
    setStep("starting");
    try {
      // The CLI opens the browser itself; the URL is kept for "Reopen".
      const { url } = accountId
        ? await claudeAuthLoginStart(accountKind === "console", accountId)
        : await addClaudeAccount(accountKind === "console");
      setLoginUrl(url);
      setStep("awaiting-browser");
    } catch (e) {
      setError(message(e));
      resetLogin();
    }
    refresh().catch(() => {});
  };

  const submitCode = async (code: string) => {
    setError(null);
    setStep("submitting");
    try {
      const r = await claudeAuthLoginSubmitCode(code);
      if (r.ok) {
        resetLogin();
        await refresh();
      } else {
        setError(r.error ?? "Login failed.");
        setStep("awaiting-code");
      }
    } catch (e) {
      setError(message(e));
      setStep("awaiting-code");
    }
  };

  const cancelLogin = () => {
    claudeAuthLoginCancel().catch(() => {});
    setError(null);
    resetLogin();
    refresh().catch(() => {});
  };

  /** Wrap a mutation so failures surface and the list always re-reads. */
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const rows = useMemo(
    () => (accounts ? claudeAccountRows(accounts, activeId) : null),
    [accounts, activeId],
  );

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Stay signed in to several Claude accounts at once and switch between them instantly — no logging out, no terminal."
        title="Claude account"
      />
      <SettingsScreenDetailBody>
        <ClaudeAccountsPanel
          accountKind={accountKind}
          accounts={rows}
          busy={busy}
          error={error}
          loginUrl={loginUrl}
          step={step}
          onAccountKindChange={setAccountKind}
          onCancelSignIn={cancelLogin}
          onOpenLoginUrl={() => {
            if (loginUrl) {
              openExternalUrl(loginUrl).catch(() => {});
            }
          }}
          onReauth={(id) => startLogin(id)}
          onRemove={(id) => run(() => removeClaudeAccount(id))}
          onRename={(id, label) => run(() => renameClaudeAccount(id, label))}
          onSelect={(id) => run(() => setActiveClaudeAccount(id))}
          onStartSignIn={() => startLogin()}
          onSubmitCode={(code) => submitCode(code)}
        />
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}
