/**
 * `/settings/claude-accounts`: the computer's Claude accounts, which one new
 * agents run as, and signing one in from here. The browser opens on the
 * computer, so finishing here means pasting the code it shows.
 */

import { useEffect, useMemo, useState } from "react";
import {
  claudeAccountRows,
  claudeSignInOutcome,
  claudeSignInPhase,
} from "@argus/client-core";
import { type ClaudeAccountKind, ClaudeAccountsPanel } from "@argus/peacock";
import { useClaudeAccountsStore } from "../../stores/claudeAccounts";
import { useConnectionStore } from "../../stores/connection";

export function ClaudeAccountsPage() {
  const connection = useConnectionStore((s) => s.connection);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const store = useClaudeAccountsStore();
  const { refresh, loadLoginStatus } = store;
  const [kind, setKind] = useState<ClaudeAccountKind>("claudeai");
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (connection === "ready") {
      refresh().catch(() => {});
      loadLoginStatus().catch(() => {});
    }
  }, [connection, refresh, loadLoginStatus]);

  const rows = useMemo(
    () =>
      store.accounts ? claudeAccountRows(store.accounts, store.activeId) : null,
    [store.accounts, store.activeId],
  );
  const step = claudeSignInPhase(store.login, { starting, submitting });

  const startSignIn = (accountId?: string) => {
    setStarting(true);
    store
      .startSignIn({ accountId, useConsole: kind === "console" })
      .finally(() => setStarting(false));
  };

  return (
    <div className="aw-settings">
      <ClaudeAccountsPanel
        browserOn="computer"
        accountKind={kind}
        accounts={rows}
        busy={store.busy}
        canManage={hasControl}
        error={store.error ?? store.load.error}
        loginUrl={store.loginUrl}
        outcome={claudeSignInOutcome(store.login)}
        step={step}
        onAccountKindChange={setKind}
        onCancelSignIn={() => {
          store.cancelSignIn().catch(() => {});
        }}
        onReauth={(id) => startSignIn(id)}
        onRemove={(id) => {
          store.remove(id).catch(() => {});
        }}
        onRename={(id, label) => {
          store.rename(id, label).catch(() => {});
        }}
        onSelect={(id) => {
          store.setActive(id).catch(() => {});
        }}
        onStartSignIn={() => startSignIn()}
        onSubmitCode={(code) => {
          setSubmitting(true);
          store.submitCode(code).finally(() => setSubmitting(false));
        }}
      />
    </div>
  );
}
