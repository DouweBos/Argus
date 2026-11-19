package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import kotlinx.coroutines.flow.update

/**
 * Tell the host which session this client shows (null for none), so it keeps a
 * warm agent there. Returns a token for [stopViewing], so a screen only clears what it set.
 */
suspend fun HostStore.reportViewing(sessionId: String?, runnerId: String? = null): Int {
  viewingToken += 1
  val token = viewingToken
  _viewingSessionId.value = sessionId
  viewingRunnerId = if (sessionId == null) null else runnerId
  sendViewing()
  return token
}

/** A screen that said what it shows is going away: put back [restoring], unless another screen spoke since. */
suspend fun HostStore.stopViewing(token: Int, restoring: String? = null) {
  if (token != viewingToken) return
  reportViewing(restoring)
}

internal suspend fun HostStore.sendViewing() {
  val backend = backend ?: return
  runCatching { backend.request(Methods.SessionsViewing, MethodsTypes.SessionsViewingParams(_viewingSessionId.value, viewingRunnerId)) }
}

/** Slash commands and models for a start composer: the warm agent's, else what that runner last reported. */
suspend fun HostStore.loadStartOptions(sessionId: String, runnerId: String? = null) {
  val backend = backend ?: return
  val result = runCatching { backend.request(Methods.SessionsStartOptions, MethodsTypes.SessionsStartOptionsParams(sessionId, runnerId)) }.getOrNull() ?: return
  _startOptionsBySession.update { it + (sessionId to result.capabilities) }
}
