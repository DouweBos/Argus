package dev.houwert.argus.app.stores

import dev.houwert.argus.core.backend.GatewayBackend
import dev.houwert.argus.kit.protocol.generated.EventsTypes

/** The Android pieces around [AppStore] that need a Context: notifications, push, widgets. */
interface AppPlatform {
  /** The computer asked for a notification while connected. */
  fun notify(payload: EventsTypes.NotificationPayload) {}

  /** A fresh connection: register for push, replay queued answers. */
  suspend fun connected(backend: GatewayBackend) {}

  object None : AppPlatform
}
