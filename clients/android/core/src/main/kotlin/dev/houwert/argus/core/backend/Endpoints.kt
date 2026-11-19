package dev.houwert.argus.core.backend

import dev.houwert.argus.kit.storage.RemoteEndpoint
import dev.houwert.argus.kit.protocol.generated.RemoteEndpoint as WireEndpoint

/** The wire's endpoint as a pairing stores it; null for a kind this client doesn't know. */
fun WireEndpoint.toStored(): RemoteEndpoint? {
  val kind = RemoteEndpoint.Kind.entries.firstOrNull { it.name.equals(this.kind.rawValue, ignoreCase = true) } ?: return null
  return RemoteEndpoint(kind, url, priority.toInt())
}
