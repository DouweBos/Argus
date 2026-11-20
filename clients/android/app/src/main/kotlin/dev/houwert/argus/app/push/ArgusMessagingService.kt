package dev.houwert.argus.app.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dev.houwert.argus.app.ArgusApplication
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import dev.houwert.argus.app.notifications.Notifier
import dev.houwert.argus.app.telemetry.Telemetry
import dev.houwert.argus.app.telemetry.TelemetryEvent
import dev.houwert.argus.core.account.AccountPushToken
import dev.houwert.argus.core.account.AccountStore
import dev.houwert.argus.core.account.handleWake
import dev.houwert.argus.core.account.resumeForWake
import dev.houwert.argus.kit.storage.PreferenceKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import dev.houwert.argus.app.storage.AndroidSecretStore
import dev.houwert.argus.kit.push.ArgusSeal
import dev.houwert.argus.kit.push.PushData
import dev.houwert.argus.kit.push.SealedNotification

/**
 * Opens what the computer sent through the relay. Pushes arrive as data-only
 * messages carrying a sealed blob the relay can't read, so this is the only
 * place the real title, body and actions exist before they reach the shade.
 */
class ArgusMessagingService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    (application as ArgusApplication).platform.push.tokenRefreshed()
  }

  override fun onMessageReceived(message: RemoteMessage) {
    message.data[PushData.SEALED]?.let { received(this, it) }
    AccountWake.reason(message.data)?.let { accountWoken(it) }
  }

  /** Runs on FCM's worker thread, which lets the process live only while this returns. */
  private fun accountWoken(reason: TelemetryEvent.WakeReason) {
    val app = (application as ArgusApplication).app
    val context = this
    val wake = AccountWake(
      preferences = app.preferences,
      wake = { seen ->
        // Launched by this push, the account may not have loaded yet: read what this device already trusts.
        if (app.account.phase.value == AccountStore.Phase.Ready || app.account.resumeForWake()) {
          val token = app.preferences.string(PreferenceKey.PUSH_TOKEN)?.let {
            AccountPushToken(token = it, environment = "production", pushKey = PushTokens.relayKeys(AndroidSecretStore(context)).pushKey)
          }
          app.account.handleWake(seen, token)
        } else {
          null
        }
      },
      inForeground = { ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) },
      notify = { tag, notification -> Notifier.post(context, notification, tag) },
      capture = Telemetry::capture,
    )
    // The account store is driven from the main thread everywhere else.
    runBlocking(Dispatchers.Main) { withTimeoutOrNull(WAKE_BUDGET_MS) { wake.handle(reason) } }
  }

  companion object {
    /** FCM gives a data message about 20 seconds; leave room to spare. */
    private const val WAKE_BUDGET_MS = 15_000L

    /** Open and show one sealed push; shared with the debug fixture receiver. */
    fun received(context: android.content.Context, sealed: String) {
      val opened = PushTokens.storedPushKey(AndroidSecretStore(context))?.let { ArgusSeal.open(sealed, it) }
      // A vague alert beats both a missing one and a shade full of ciphertext.
      val notification = opened ?: SealedNotification(title = "Argus", body = "An agent needs your attention.", kind = "push")
      Notifier.post(context, notification)
      (context.applicationContext as ArgusApplication).platform.pushReceived(notification)
    }
  }
}
