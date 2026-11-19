package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.EventsTypes
import dev.houwert.argus.kit.storage.RemoteEndpoint

/**
 * The app concerns a store reports to rather than owns: analytics, error
 * telemetry, notifications, push bookkeeping. Every hook defaults to nothing.
 * All are called on the store's dispatcher.
 */
class HostStoreHooks(
  val track: (StoreEvent) -> Unit = {},
  errorReported: (Throwable, String) -> Unit = { _, _ -> },
  /** The host asked for a notification to be shown. */
  val notify: (EventsTypes.NotificationPayload) -> Unit = {},
  /** Agents seen on this host, so a push carrying only an agent id can be routed back to it. */
  val agentsSeen: (List<String>) -> Unit = {},
  /** The host's reachable addresses changed. */
  val endpointsChanged: (List<RemoteEndpoint>) -> Unit = {},
  /** A permission answer couldn't be delivered; queue it for the next connection. */
  val decisionUndelivered: (agentId: String, toolUseId: String, decision: String) -> Unit = { _, _, _ -> },
  /** The backend's connection went up or down on its own (not an attach or detach). */
  val connectionChanged: (Transport.State) -> Unit = {},
) {
  /** Quiet errors (cancellations, background refreshes that lost the connection) never reach the app. */
  val errorReported: (Throwable, String) -> Unit = { error, scope ->
    if (!HostStore.isQuiet(error)) errorReported(error, scope)
  }
}
