/**
 * Account-switcher actions as clients invoke them: each mutation tells every
 * window the list moved.
 */

import {
  type ClaudeAccount,
  getActiveAccountId,
  refreshAllAccountIdentities,
  removeClaudeAccount,
  renameClaudeAccount,
  setActiveAccount,
} from "./accounts";
import { emitAccountsChanged } from "./claudeAuth";
import { recheckFlaggedAccounts } from "./probe";

export interface ClaudeAccountsState {
  accounts: ClaudeAccount[];
  activeId: string;
}

/** The switcher's rows. Opening it is also when flagged accounts get re-probed. */
export function listClaudeAccountsState(): ClaudeAccountsState {
  recheckFlaggedAccounts();

  return {
    accounts: refreshAllAccountIdentities(),
    activeId: getActiveAccountId(),
  };
}

export function switchClaudeAccount(id: string): void {
  setActiveAccount(id);
  emitAccountsChanged();
}

export async function forgetClaudeAccount(id: string): Promise<void> {
  await removeClaudeAccount(id);
  emitAccountsChanged();
}

export function relabelClaudeAccount(id: string, label: string): void {
  renameClaudeAccount(id, label);
  emitAccountsChanged();
}
