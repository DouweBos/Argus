package dev.houwert.argus.app.stores

import dev.houwert.argus.core.account.AccountStore
import dev.houwert.argus.core.account.AccountSyncChannel
import dev.houwert.argus.core.account.link
import dev.houwert.argus.core.account.sync
import dev.houwert.argus.core.offline.Outbox
import dev.houwert.argus.core.offline.SavedAnswers
import dev.houwert.argus.core.stores.liveBackend
import dev.houwert.argus.kit.account.AccountClient
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.storage.DeviceIdentity
import dev.houwert.argus.kit.storage.PreferenceKey
import dev.houwert.argus.kit.storage.Preferences
import kotlinx.coroutines.launch

// The account's half of the host list: computers on the signed-in account show up beside the QR
// pairings, and connect with no QR.

/** The device kind this phone joins the account as. */
internal const val ACCOUNT_DEVICE_KIND = "android"

/** The account service: a preference (debug builds set it from a launch extra), else the built-in one. */
const val ACCOUNT_URL_KEY = "argus.account.url"

internal fun accountBaseUrl(preferences: Preferences): String =
  preferences.string(ACCOUNT_URL_KEY)?.takeIf { it.isNotBlank() } ?: AccountClient.DEFAULT_BASE_URL

internal suspend fun AppStore.startAccount() {
  account.onHostsChanged = { identities -> scope.launch { accountHostsChanged(identities) } }
  // A removal reaches the connected computer at once, not at its next poll.
  account.onLogAppended = { scope.launch { syncAccount() } }
  // Set here, renamed from the account list, or renamed from another device.
  account.onNameChanged = { name -> scope.launch { applyDeviceName(name) } }
  account.start()
}

/** Hand the connected computer account entries it hasn't seen. */
internal suspend fun AppStore.syncAccount() {
  val backend = host.liveBackend ?: return
  account.sync(AccountSyncChannel.backend(backend))
}

/** A pairing's fields live in the keystore; an account host's only here. True when [deviceId] was one. */
internal fun AppStore.patchAccountHost(deviceId: String, patch: (DeviceIdentity) -> DeviceIdentity): Boolean {
  val hosts = _accountHosts.value
  val index = hosts.indexOfFirst { it.deviceId == deviceId }
  if (index < 0) return false
  _accountHosts.value = hosts.toMutableList().also { it[index] = patch(it[index]) }
  return true
}

private suspend fun AppStore.accountHostsChanged(identities: List<DeviceIdentity>) {
  val previous = _accountHosts.value
  _accountHosts.value = identities.map { identity ->
    previous.firstOrNull { it.deviceId == identity.deviceId }?.let { identity.copy(capabilities = it.capabilities) } ?: identity
  }
  val activeId = _activeHostId.value?.takeIf { it.startsWith("account:") } ?: return
  val current = _accountHosts.value.firstOrNull { it.deviceId == activeId }
  if (current == null) {
    // Taken off the account (or signed out): it can't be reached any more.
    if (previous.any { it.deviceId == activeId }) {
      SavedAnswers.remove(sealedFiles, activeId)
      Outbox.remove(sealedFiles, activeId)
      disconnect()
      host.reset()
      _identity.value = null
      _activeHostId.value = null
      keystore.setActive(null)
    }
    return
  }
  val moved = previous.firstOrNull { it.deviceId == activeId }?.endpoints != current.endpoints
  // First listed after launch, or its tunnel moved while it couldn't be reached.
  if (host.liveBackend == null || (moved && host.connection.value == dev.houwert.argus.kit.net.Transport.State.Offline)) connect(current)
}

/** Put the connected QR-paired computer on the account: it hands over a link code, approved like a typed one. */
suspend fun AppStore.addConnectedHostToAccount() {
  val backend = host.liveBackend ?: return
  try {
    val result = backend.request(Methods.AccountRequestLink, MethodsTypes.AccountRequestLinkParams())
    account.link(result.userCode, viaPairing = true)
  } catch (e: kotlinx.coroutines.CancellationException) {
    throw e
  } catch (e: Exception) {
    host.report(e, "account_request_link")
  }
}

/** Online/offline from the account directory; null for a QR pairing. */
fun AppStore.presence(of: DeviceIdentity): AccountStore.Host? = of.accountHostId?.let { account.host(it) }
