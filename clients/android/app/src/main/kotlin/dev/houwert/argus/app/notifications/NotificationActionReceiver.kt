package dev.houwert.argus.app.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import dev.houwert.argus.app.ArgusApplication
import dev.houwert.argus.core.stores.StoreEvent
import dev.houwert.argus.core.stores.respond
import dev.houwert.argus.core.stores.sendMessage
import dev.houwert.argus.core.stores.setActiveClaudeAccount
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.push.NotificationAction
import dev.houwert.argus.kit.push.NotificationExtra
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Approve, Deny, Reply and a usage warning's Switch from the shade, without opening the app. An answer is
 * persisted before it is sent: one given on a train has to survive until there
 * is a connection to send it on.
 */
class NotificationActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val app = (context.applicationContext as ArgusApplication).app
    val tag = intent.getStringExtra(EXTRA_TAG)
    if (intent.action == NotificationAction.SWITCH_ACCOUNT) {
      val accountId = intent.getStringExtra(NotificationExtra.ACCOUNT_ID) ?: return
      val pending = goAsync()
      app.scope.launch {
        try {
          tag?.let { Notifier.cancel(context, it) }
          if (awaitConnection(app)) app.host.setActiveClaudeAccount(accountId, StoreEvent.AccountAction.UsageWarning)
        } finally {
          pending.finish()
        }
      }
      return
    }
    val agentId = intent.getStringExtra(NotificationExtra.AGENT_ID) ?: return
    val pending = goAsync()
    app.scope.launch {
      try {
        when (intent.action) {
          NotificationAction.APPROVE, NotificationAction.DENY -> {
            val toolUseId = intent.getStringExtra(NotificationExtra.TOOL_USE_ID) ?: return@launch
            val decision = if (intent.action == NotificationAction.APPROVE) "allow" else "deny"
            app.queueOfflineDecision(agentId, toolUseId, decision)
            tag?.let { Notifier.cancel(context, it) }
            // Woken from cold, the app is still racing its addresses; give it a moment before leaving it queued.
            if (awaitConnection(app)) app.host.respond(agentId, toolUseId, decision, fromNotification = true)
          }
          REPLY -> {
            val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Notifier.REPLY_KEY)?.toString()?.trim()
            if (text.isNullOrEmpty()) return@launch
            tag?.let { Notifier.cancel(context, it) }
            if (awaitConnection(app)) app.host.sendMessage(agentId, text) else Notifier.replyFailed(context, agentId)
          }
        }
      } finally {
        pending.finish()
      }
    }
  }

  private suspend fun awaitConnection(app: dev.houwert.argus.app.stores.AppStore): Boolean =
    withTimeoutOrNull(8_000) { app.host.connection.first { it == Transport.State.Ready } } != null

  companion object {
    const val REPLY = "dev.houwert.argus.REPLY"
    const val EXTRA_TAG = "tag"
  }
}
