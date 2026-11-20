package dev.houwert.argus.app.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dev.houwert.argus.app.storage.AndroidSecretStore
import dev.houwert.argus.kit.push.ArgusSeal
import dev.houwert.argus.kit.push.SealedNotification
import dev.houwert.argus.kit.push.SealedNotificationAction
import java.security.SecureRandom

/**
 * Debug only: seals a fixture with this install's push key and feeds it through the FCM path,
 * so notifications can be checked without a Firebase project.
 * `adb shell am broadcast -n dev.houwert.argus.dev/dev.houwert.argus.app.push.FixturePushReceiver --es kind permission`
 */
class FixturePushReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val kind = intent.getStringExtra("kind") ?: "permission"
    val agentId = intent.getStringExtra("agent") ?: "agent-fixture"
    val fixture = SealedNotification(
      title = intent.getStringExtra("title") ?: if (kind == "permission") "Approve Bash" else "Agent finished",
      body = intent.getStringExtra("body") ?: if (kind == "permission") "npm test" else "All tests pass.",
      kind = kind,
      agentId = agentId,
      toolUseId = if (kind == "permission") "tu-fixture" else null,
      actions = if (kind == "permission") listOf(SealedNotificationAction("approve", "Approve"), SealedNotificationAction("deny", "Deny")) else emptyList(),
    )
    val key = PushTokens.relayKeys(AndroidSecretStore(context)).pushKey
    val sealed = ArgusSeal.seal(fixture, key, ByteArray(12).also(SecureRandom()::nextBytes))
    ArgusMessagingService.received(context, sealed)
  }
}
