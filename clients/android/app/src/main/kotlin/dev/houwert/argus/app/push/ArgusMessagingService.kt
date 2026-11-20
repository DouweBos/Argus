package dev.houwert.argus.app.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dev.houwert.argus.app.ArgusApplication
import dev.houwert.argus.app.notifications.Notifier
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
  }

  companion object {
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
