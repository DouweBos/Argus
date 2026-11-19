package dev.houwert.argus.core.stores

import dev.houwert.argus.core.backend.HostBackend
import dev.houwert.argus.kit.net.Transport
import kotlin.time.Duration
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Work bound to this connection (device streams, terminals) that a route switch would break; wave-2 screens extend it. */
val HostStore.hasConnectionBoundWork: Boolean get() = connectionBoundWork > 0

/**
 * Move to a better route without dropping the computer's data: adopt the new
 * backend, re-read what a fresh connection loses, and close the old one only
 * once requests in flight on it have had time to answer.
 */
fun HostStore.swapBackend(next: HostBackend, drain: Duration = Transport.LONGEST_REQUEST_TIMEOUT) {
  val previous = liveBackend
  attach(next)
  resyncTranscripts()
  resyncQueues()
  previous ?: return
  scope.launch {
    delay(drain)
    previous.disconnect()
  }
}
