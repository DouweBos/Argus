package dev.houwert.argus.app.stores

import dev.houwert.argus.core.account.AccountStore
import dev.houwert.argus.core.backend.GatewayBackend
import dev.houwert.argus.core.backend.toStored
import dev.houwert.argus.core.hosts.RouteSupervisor
import dev.houwert.argus.core.offline.Outbox
import dev.houwert.argus.core.offline.SavedAnswers
import dev.houwert.argus.core.stores.BackgroundRefresh
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.HostStoreHooks
import dev.houwert.argus.core.stores.hasConnectionBoundWork
import dev.houwert.argus.core.stores.liveBackend
import dev.houwert.argus.core.stores.openOffline
import dev.houwert.argus.core.stores.refreshHeldLists
import dev.houwert.argus.core.stores.swapBackend
import dev.houwert.argus.kit.account.AccountAuthenticating
import dev.houwert.argus.kit.account.KeystoreAccountVault
import dev.houwert.argus.kit.net.EndpointRacer
import dev.houwert.argus.kit.net.NetworkPathWatcher
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.storage.DeviceIdentity
import dev.houwert.argus.kit.storage.Keystore
import dev.houwert.argus.kit.storage.PreferenceKey
import dev.houwert.argus.kit.storage.Preferences
import dev.houwert.argus.kit.storage.RemoteEndpoint
import dev.houwert.argus.kit.storage.SealedFiles
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * The app's state around the one [HostStore]: which computers are paired,
 * which one is active, and the connection lifecycle to it (race its addresses,
 * attach, re-race on network changes, recheck on returning to the foreground).
 *
 * [scope] must be the main scope; all state lives on it.
 */
class AppStore(
  internal val scope: CoroutineScope,
  val keystore: Keystore,
  val preferences: Preferences,
  internal val sealedFiles: SealedFiles,
  networkPaths: NetworkPathWatcher,
  /** This phone's name as computers list it. */
  private val defaultDeviceName: String,
  /** The Argus account's sign-in provider (Clerk). */
  accountAuth: AccountAuthenticating,
) {
  val host = HostStore(scope)
  /** The Argus account: sign-in, and the computers on it. Wired in [AppStoreAccount]. */
  val account = AccountStore(scope, accountAuth, KeystoreAccountVault(keystore), ACCOUNT_DEVICE_KIND, { deviceName }, baseUrl = accountBaseUrl(preferences))

  private val _pairedHosts = MutableStateFlow(emptyList<DeviceIdentity>())
  val pairedHosts: StateFlow<List<DeviceIdentity>> = _pairedHosts.asStateFlow()
  /** Hosts on the signed-in account, rebuilt from its verified log; their grants live here only. */
  internal val _accountHosts = MutableStateFlow(emptyList<DeviceIdentity>())
  val accountHosts: StateFlow<List<DeviceIdentity>> = _accountHosts.asStateFlow()
  /** Every computer this phone can reach, one row each. */
  val hosts: StateFlow<List<DeviceIdentity>> =
    combine(_pairedHosts, _accountHosts) { paired, account -> DeviceIdentity.merging(paired, account) }
      .stateIn(scope, SharingStarted.Eagerly, emptyList())
  private val allHosts get() = DeviceIdentity.merging(_pairedHosts.value, _accountHosts.value)
  internal val _activeHostId = MutableStateFlow<String?>(null)
  val activeHostId: StateFlow<String?> = _activeHostId.asStateFlow()
  /** The computer being connected to or shown. */
  internal val _identity = MutableStateFlow<DeviceIdentity?>(null)
  val identity: StateFlow<DeviceIdentity?> = _identity.asStateFlow()
  /** False until the stored pairings are read, so the first frame doesn't flash the pair screen. */
  private val _loaded = MutableStateFlow(false)
  val loaded: StateFlow<Boolean> = _loaded.asStateFlow()

  val deviceName: String get() = preferences.string(PreferenceKey.DEVICE_NAME)?.takeIf { it.isNotBlank() } ?: defaultDeviceName

  private var started: Job? = null
  private var connectGeneration = 0
  private val routes: RouteSupervisor

  init {
    host.hooks = HostStoreHooks(
      endpointsChanged = { endpoints -> scope.launch { endpointsChanged(endpoints) } },
      connectionChanged = { state ->
        if (state == Transport.State.Ready || state == Transport.State.Offline) routes.connectionChanged(state == Transport.State.Ready)
      },
    )
    routes = RouteSupervisor(
      RouteSupervisor.Hooks(
        identity = { currentIdentity },
        busy = { host.hasConnectionBoundWork },
        adopt = { attempt, upgrade -> adoptRoute(attempt, upgrade) },
      ),
      networkPaths,
      scope,
    )
  }

  // Lifecycle

  fun initialize() {
    if (started == null) started = scope.launch { load() }
  }

  private suspend fun load() {
    val stored = keystore.load()
    _pairedHosts.value = stored.hosts
    _activeHostId.value = stored.activeId
    _loaded.value = true
    // An account host connects once the account's log has listed it.
    scope.launch { startAccount() }
    stored.active?.let { connect(it) }
  }

  /** Back in the foreground: moved tunnels picked up, a socket that died while suspended reconnects, lists refreshed. */
  fun enteredForeground() {
    recheckRoutes()
    if (host.connection.value == Transport.State.Ready) {
      scope.launch { BackgroundRefresh.run { host.refreshHeldLists() } }
    }
  }

  suspend fun selectHost(deviceId: String) {
    val identity = allHosts.firstOrNull { it.deviceId == deviceId } ?: return
    if (deviceId == _activeHostId.value && host.liveBackend != null && host.connection.value != Transport.State.Offline) return
    // Adopt the target before awaiting, so a screen pushed on the same tap can name it.
    _identity.value = identity
    _activeHostId.value = deviceId
    host.setCapabilities(identity.capabilities)
    disconnect()
    host.reset()
    keystore.setActive(deviceId)
    connect(identity)
  }

  suspend fun pairCompleted(identity: DeviceIdentity) {
    disconnect()
    host.reset()
    val state = keystore.add(identity)
    _pairedHosts.value = state.hosts
    _activeHostId.value = state.activeId
    connect(identity)
  }

  suspend fun renameHost(deviceId: String, name: String) {
    val trimmed = name.trim().takeIf { it.isNotEmpty() } ?: return
    val state = keystore.update(deviceId) { it.copy(hostName = trimmed) }
    _pairedHosts.value = state.hosts
    if (_identity.value?.deviceId == deviceId) _identity.value = _identity.value?.copy(hostName = trimmed)
  }

  suspend fun unpairHost(deviceId: String) {
    if (_activeHostId.value == deviceId) {
      // Best-effort: an offline unpair must still succeed locally.
      runCatching { host.liveBackend?.request(Methods.DeviceUnregisterPush, MethodsTypes.DeviceUnregisterPushParams()) }
      disconnect()
      host.reset()
    }
    SavedAnswers.remove(sealedFiles, deviceId)
    Outbox.remove(sealedFiles, deviceId)
    val state = keystore.remove(deviceId)
    _pairedHosts.value = state.hosts
    _activeHostId.value = state.activeId
    _identity.value = null
    host.setCapabilities(emptyList())
  }

  suspend fun connect(identity: DeviceIdentity) {
    _identity.value = identity
    host.setCapabilities(identity.capabilities)
    val generation = ++connectGeneration
    host.beginConnecting()
    routes.suspend()
    // What was saved shows while the connection is raced, and if it never comes.
    host.openOffline(SavedAnswers.forHost(sealedFiles, identity.deviceId), Outbox.forHost(sealedFiles, identity.deviceId))
    if (generation != connectGeneration) return
    try {
      val attempt = EndpointRacer.connectBest(identity)
      // The user may have switched computers while this was racing.
      if (generation != connectGeneration) {
        attempt.transport.disconnect()
        attempt.transport.close()
        return
      }
      if (identity.isAccountHost) account.setConnectionFailing(false)
      val backend = GatewayBackend(attempt.transport)
      host.attach(backend)
      routes.connected(attempt.endpoint)
      onReady(backend, identity, attempt.url)
    } catch (e: EndpointRacer.RaceException) {
      if (generation != connectGeneration) return
      host.connectFailed("Couldn't reach this computer on any known address.")
      // Re-raced on the next network change or recheck.
      routes.connected(null)
      // Its tunnel may have moved: watch the directory for the new address.
      if (identity.isAccountHost) account.setConnectionFailing(true)
    }
  }

  suspend fun disconnect() {
    routes.suspend()
    host.detach()
  }

  private val currentIdentity: DeviceIdentity?
    get() {
      val id = _identity.value?.deviceId ?: return null
      if (_activeHostId.value != id) return null
      return allHosts.firstOrNull { it.deviceId == id } ?: _identity.value
    }

  fun recheckRoutes() {
    routes.recheck()
    // A socket that died while suspended still reads as ready until something fails on it.
    (host.liveBackend as? GatewayBackend)?.transport?.checkAlive()
  }

  private suspend fun adoptRoute(attempt: EndpointRacer.Attempt, upgrade: Boolean): Boolean {
    val identity = currentIdentity ?: return false
    if (identity.isAccountHost) account.setConnectionFailing(false)
    val backend = GatewayBackend(attempt.transport)
    if (host.liveBackend == null) {
      // The connect that failed, reaching it now: the full post-connect run.
      connectGeneration++
      host.attach(backend)
      onReady(backend, identity, attempt.url)
      return true
    }
    host.swapBackend(backend)
    updateHost(identity.deviceId) { it.copy(url = attempt.url) }
    return true
  }

  private suspend fun onReady(backend: GatewayBackend, identity: DeviceIdentity, winningUrl: String) {
    runCatching { backend.request(Methods.DeviceRename, MethodsTypes.DeviceRenameParams(deviceName)) }
    // Grants may have changed while this phone was away.
    runCatching { backend.request(Methods.DeviceCapabilities, MethodsTypes.DeviceCapabilitiesParams()) }.getOrNull()?.let { result ->
      host.setCapabilities(result.capabilities)
      updateHost(identity.deviceId) { it.copy(capabilities = result.capabilities) }
    }
    syncAccount()
    // Learn the tunnels of a phone paired over Wi-Fi, without forgetting one that just isn't up now.
    runCatching { backend.request(Methods.HostEndpoints, MethodsTypes.HostEndpointsParams()) }.getOrNull()?.let { result ->
      val live = result.endpoints.mapNotNull { it.toStored() }
      updateHost(identity.deviceId) { it.copy(endpoints = DeviceIdentity.mergedEndpoints(it.endpoints, live), url = winningUrl) }
      _identity.value = allHosts.firstOrNull { it.deviceId == identity.deviceId } ?: _identity.value
    }
  }

  private suspend fun endpointsChanged(endpoints: List<RemoteEndpoint>) {
    val deviceId = _identity.value?.deviceId ?: return
    updateHost(deviceId) { it.copy(endpoints = DeviceIdentity.mergedEndpoints(it.endpoints, endpoints)) }
  }

  private fun updateHost(deviceId: String, patch: (DeviceIdentity) -> DeviceIdentity) {
    if (patchAccountHost(deviceId, patch)) return
    _pairedHosts.value = keystore.update(deviceId, patch).hosts
  }
}
