package dev.houwert.argus.app.platform

import android.content.Context
import dev.houwert.argus.app.telemetry.Telemetry
import dev.houwert.argus.app.telemetry.TelemetryEvent
import dev.houwert.argus.app.widgets.WidgetSync
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import dev.houwert.argus.app.notifications.Notifier
import dev.houwert.argus.app.push.PushController
import dev.houwert.argus.app.stores.AppPlatform
import dev.houwert.argus.app.stores.AppStore
import dev.houwert.argus.core.backend.GatewayBackend
import dev.houwert.argus.kit.protocol.generated.EventsTypes
import dev.houwert.argus.kit.push.SealedNotification
import dev.houwert.argus.kit.storage.SecretStore

/** Everything [AppStore] reports that needs Android: notifications, push registration, widgets. */
class AndroidPlatform(val context: Context, private val app: AppStore, secrets: SecretStore) : AppPlatform {
  val push = PushController(context, app, secrets)
  val launches = LaunchRouter(app)
  val widgets = WidgetSync(context, app)

  /** Per process, like the iPhone's per launch: rotating or reopening the window doesn't lock again. */
  private val _unlocked = MutableStateFlow(false)
  val unlocked: StateFlow<Boolean> = _unlocked.asStateFlow()

  fun unlock() {
    _unlocked.value = true
    launches.unlocked()
  }

  init {
    Notifier.createChannels(context)
    AppShortcuts.install(context)
    widgets.start()
    launches.opened = { pattern, via, fallback ->
      Telemetry.capture(TelemetryEvent.LinkOpened(pattern, TelemetryEvent.LinkSource.valueOf(via.name), fallback))
    }
  }

  override fun notify(payload: EventsTypes.NotificationPayload) = Notifier.presentInBand(context, payload)

  override suspend fun connected(backend: GatewayBackend) {
    push.register(backend)
    push.syncAlerts(backend)
    push.flushPendingDecisions(backend)
  }

  /** A push arrived, maybe with the app not running: flag or clear its agent on the widgets now. */
  fun pushReceived(notification: SealedNotification) {
    app.scope.launch { widgets.pushReceived(notification) }
  }
}
