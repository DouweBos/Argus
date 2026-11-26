package dev.houwert.argus.core.stores

import dev.houwert.argus.core.git.LineAttribution
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes

/** Agent-written and human-edited lines of the session's files, as they are now. */
suspend fun HostStore.loadLineAttribution(sessionId: String): LineAttribution {
  val backend = backend ?: return LineAttribution()
  return LineAttribution.of(backend.request(Methods.SessionsLineAttribution, MethodsTypes.SessionsLineAttributionParams(sessionId)))
}
