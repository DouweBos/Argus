package dev.houwert.argus.core.stores

import dev.houwert.argus.core.backend.HostBackendKind
import dev.houwert.argus.core.backend.RawCommand
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeLoginState
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/*
 * The computer's Claude accounts: which plans are signed in, which one new agents run as, and how to
 * add, rename, forget or re-authenticate one. A sign-in opens a browser on the computer, so the phone
 * follows the attempt and finishes it by pasting the code the CLI prints.
 */

suspend fun HostStore.refreshClaudeAccounts() {
  val backend = backend ?: return
  val result = runCatching { backend.request(Methods.ClaudeAccountsList, MethodsTypes.ClaudeAccountsListParams()) }.getOrNull() ?: return
  _claudeAccounts.value = result.accounts
  _activeClaudeAccountId.value = result.activeId
}

/** New agents authenticate as this account; running ones keep theirs until their next spawn. */
suspend fun HostStore.setActiveClaudeAccount(id: String) {
  hooks.track(StoreEvent.ClaudeAccountChanged(StoreEvent.AccountAction.Select))
  val backend = backend ?: return
  try {
    backend.request(Methods.ClaudeAccountsSetActive, MethodsTypes.ClaudeAccountsSetActiveParams(id))
    _activeClaudeAccountId.value = id
    refreshClaudeAccounts()
  } catch (e: Exception) {
    report(e, "claude_accounts")
  }
}

private val setClaudeAccount = RawCommand("agents.set_claude_account", JsonElement.serializer())

/** Pin the agent's session to an account, or null to follow the computer's active one. */
suspend fun HostStore.setSessionClaudeAccount(sessionId: String, accountId: String?, agentId: String) {
  hooks.track(StoreEvent.ClaudeAccountChanged(StoreEvent.AccountAction.Pin))
  val backend = backend ?: return
  // An explicit null means "follow the active account".
  val params = buildJsonObject {
    put("agent_id", JsonPrimitive(agentId))
    put("account_id", accountId?.let(::JsonPrimitive) ?: JsonNull)
  }
  try {
    backend.request(setClaudeAccount, params)
    // Nothing re-broadcasts the session list on this write.
    _sessionsByRepo.update { all ->
      all.mapValues { (_, sessions) -> sessions.map { if (it.id == sessionId) it.copy(claudeAccountId = accountId) else it } }
    }
  } catch (e: Exception) {
    report(e, "claude_accounts")
  }
}

fun HostStore.claudeAccountId(sessionId: String): String? =
  _sessionsByRepo.value.values.asSequence().flatten().firstOrNull { it.id == sessionId }?.claudeAccountId

/** Opens the computer's browser; the account it lands on fills in with the next refresh. */
suspend fun HostStore.addClaudeAccount(useConsole: Boolean): Boolean {
  hooks.track(StoreEvent.ClaudeAccountChanged(StoreEvent.AccountAction.Add))
  val backend = backend ?: return false
  return try {
    val result = backend.request(Methods.ClaudeAccountsAdd, MethodsTypes.ClaudeAccountsAddParams(useConsole))
    _claudeLogin.value = RemoteClaudeLoginState(pending = true, needsCode = false)
    openLoginUrl(result.url)
    refreshClaudeAccounts()
    true
  } catch (e: Exception) {
    _claudeLogin.value = null
    report(e, "claude_accounts")
    false
  }
}

suspend fun HostStore.removeClaudeAccount(id: String) {
  hooks.track(StoreEvent.ClaudeAccountChanged(StoreEvent.AccountAction.Remove))
  val backend = backend ?: return
  try {
    backend.request(Methods.ClaudeAccountsRemove, MethodsTypes.ClaudeAccountsRemoveParams(id))
    _claudeAccounts.update { list -> list?.filterNot { it.id == id } }
    refreshClaudeAccounts()
  } catch (e: Exception) {
    report(e, "claude_accounts")
  }
}

suspend fun HostStore.renameClaudeAccount(id: String, label: String) {
  hooks.track(StoreEvent.ClaudeAccountChanged(StoreEvent.AccountAction.Rename))
  val backend = backend ?: return
  val trimmed = label.trim().takeIf { it.isNotEmpty() } ?: return
  // Patched first so the row keeps the typed name even if the echo arrives late.
  _claudeAccounts.update { list -> list?.map { if (it.id == id) it.copy(label = trimmed) else it } }
  try {
    backend.request(Methods.ClaudeAccountsRename, MethodsTypes.ClaudeAccountsRenameParams(id, trimmed))
  } catch (e: Exception) {
    refreshClaudeAccounts()
    report(e, "claude_accounts")
  }
}

/** Re-authenticate an account whose credentials died; null [useConsole] keeps its kind. */
suspend fun HostStore.startClaudeLogin(accountId: String?, useConsole: Boolean? = null): Boolean {
  val backend = backend ?: return false
  return try {
    val result = backend.request(Methods.ClaudeAccountsLoginStart, MethodsTypes.ClaudeAccountsLoginStartParams(accountId, useConsole))
    _claudeLogin.value = RemoteClaudeLoginState(pending = true, needsCode = false)
    openLoginUrl(result.url)
    if (accountId != null) hooks.track(StoreEvent.ClaudeAccountChanged(StoreEvent.AccountAction.Reauth))
    true
  } catch (e: Exception) {
    _claudeLogin.value = null
    report(e, "claude_accounts")
    false
  }
}

/** Give up; the computer drops any placeholder account it minted for the attempt. */
suspend fun HostStore.cancelClaudeLogin() {
  val backend = backend ?: return
  runCatching { backend.request(Methods.ClaudeAccountsLoginCancel, MethodsTypes.ClaudeAccountsLoginCancelParams()) }
  _claudeLogin.value = null
  refreshClaudeAccounts()
}

/** Finish a sign-in with the code the CLI printed. */
suspend fun HostStore.submitClaudeLoginCode(code: String) {
  val backend = backend ?: return
  try {
    val result = backend.request(Methods.ClaudeAccountsLoginSubmitCode, MethodsTypes.ClaudeAccountsLoginSubmitCodeParams(code.trim()))
    if (result.ok) {
      _claudeLogin.value = RemoteClaudeLoginState(pending = false, needsCode = false, ok = true)
      refreshClaudeAccounts()
    } else {
      // The CLI exits on a wrong code, so this attempt is over.
      _claudeLogin.value = RemoteClaudeLoginState(pending = false, needsCode = false, ok = false, error = result.error)
    }
  } catch (e: Exception) {
    report(e, "claude_accounts")
  }
}

/** Where a sign-in started elsewhere has got to, for a screen opened mid-attempt. */
suspend fun HostStore.loadClaudeLoginStatus() {
  val backend = backend ?: return
  val state = runCatching { backend.request(Methods.ClaudeAccountsLoginStatus, MethodsTypes.ClaudeAccountsLoginStatusParams()) }.getOrNull()
  if (state?.pending == true) _claudeLogin.value = state
}

/** The URL authorises on the computer, so over the gateway it is shown for reading, not tapped. */
private fun HostStore.openLoginUrl(url: String) {
  if (backend?.kind == HostBackendKind.Gateway) showError("Sign in opened on your computer: $url")
}
