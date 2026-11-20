package dev.houwert.argus.app.push

import android.content.Context
import dev.houwert.argus.app.notifications.Notifier
import dev.houwert.argus.app.stores.AppStore
import dev.houwert.argus.core.backend.HostBackend
import dev.houwert.argus.core.stores.liveBackend
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.storage.PreferenceKey
import dev.houwert.argus.kit.storage.SecretStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Hands this install's FCM token and its two keys to the connected computer.
 * The relay holds the Firebase credentials but is never trusted with content:
 * one key seals the notification, the other proves which computers may push here.
 */
class PushController(private val context: Context, private val app: AppStore, private val secrets: SecretStore) {
  private val _state = MutableStateFlow(PushState.Off)
  val state: StateFlow<PushState> = _state.asStateFlow()

  val enabled: Boolean get() = app.preferences.string(PreferenceKey.PUSH_ENABLED) != "off"

  suspend fun setEnabled(on: Boolean) {
    app.preferences.set(if (on) "on" else "off", PreferenceKey.PUSH_ENABLED)
    val backend = app.host.liveBackend ?: return
    if (on) {
      register(backend)
    } else {
      runCatching { backend.request(Methods.DeviceUnregisterPush, MethodsTypes.DeviceUnregisterPushParams()) }
      _state.value = PushState.Off
    }
  }

  /** FCM rotated the token: tell the connected computer now rather than on the next connection. */
  fun tokenRefreshed() {
    val backend = app.host.liveBackend ?: return
    app.scope.launch { register(backend) }
  }

  suspend fun register(backend: HostBackend) {
    if (!enabled) return run { _state.value = PushState.Off }
    if (!PushTokens.available(context)) return run { _state.value = PushState.Unavailable }
    if (!Notifier.allowed(context)) return run { _state.value = PushState.Denied }
    val token = PushTokens.deviceToken(context) ?: return run { _state.value = PushState.NoToken }

    val info = try {
      backend.request(Methods.DevicePushInfo, MethodsTypes.DevicePushInfoParams())
    } catch (e: Exception) {
      // An older computer doesn't know the method at all.
      _state.value = PushState.Unsupported
      return
    }
    if (!info.configured) return run { _state.value = PushState.Unconfigured }

    val keys = PushTokens.relayKeys(secrets)
    info.relayUrl?.let { relay ->
      when (PushTokens.registerWithRelay(relay, token, keys.authKey)) {
        PushTokens.RelayResult.Conflict -> return run { _state.value = PushState.Conflict }
        PushTokens.RelayResult.Failed -> return run { _state.value = PushState.RelayFailed }
        PushTokens.RelayResult.Ok -> Unit
      }
    }
    _state.value = try {
      backend.request(
        Methods.DeviceRegisterPush,
        MethodsTypes.DeviceRegisterPushParams(
          service = MethodsTypes.DeviceRegisterPushParamsService(PushTokens.SERVICE),
          token = token,
          pushKey = keys.pushKey,
          authKey = keys.authKey,
        ),
      )
      app.preferences.set(token, PreferenceKey.PUSH_TOKEN)
      PushState.Registered
    } catch (e: Exception) {
      PushState.RegistrationRefused
    }
  }

  /**
   * Replay answers given from a notification while offline. The gateway only accepts an
   * answer to a prompt it forwarded to this connection, and re-forwards pending ones on
   * subscribe: hence the subscribe, the retries and the unsubscribe afterwards.
   */
  suspend fun flushPendingDecisions(backend: HostBackend) {
    for (decision in app.pendingDecisions.read(hostId = app.activeHostId.value)) {
      backend.subscribe(decision.agentId, true)
      try {
        for (attempt in 0 until 5) {
          if (attempt > 0) delay(400)
          val sent = runCatching {
            backend.request(
              Methods.PermissionRespond,
              MethodsTypes.PermissionRespondParams(
                decision.agentId,
                decision.toolUseId,
                MethodsTypes.PermissionRespondParamsDecision(decision.decision),
              ),
            )
          }.isSuccess
          if (sent) break
        }
      } finally {
        runCatching { backend.subscribe(decision.agentId, false) }
        // Cleared either way: a stale answer is worse than a missing one.
        app.pendingDecisions.clear(decision.key)
      }
    }
  }
}
