package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes

/** Every runner besides Claude Code, as the computer's CLIs report it. Signing in runs on the computer, so the phone only reads. */
suspend fun HostStore.refreshRunnerAccounts(refresh: Boolean = false) {
  val backend = backend ?: return
  try {
    _runnerAccounts.value = backend.request(Methods.RunnersAccounts, MethodsTypes.RunnersAccountsParams(refresh.takeIf { it })).runners
  } catch (e: Exception) {
    report(e, "runner_accounts")
  }
}
