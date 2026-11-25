package dev.houwert.argus.app.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import dev.houwert.argus.app.MainActivity
import dev.houwert.argus.app.R
import dev.houwert.argus.kit.push.ArgusSeal
import dev.houwert.argus.kit.push.NotificationAction
import dev.houwert.argus.kit.push.NotificationExtra
import dev.houwert.argus.kit.push.SealedNotification
import dev.houwert.argus.kit.push.SealedNotificationAction
import dev.houwert.argus.kit.protocol.generated.EventsTypes
import java.util.UUID

/** Posts what the computer asked to show, pushed or in-band, with Approve/Deny, Reply or Switch where they apply. */
object Notifier {
  const val CHANNEL_APPROVALS = "approvals"
  const val CHANNEL_AGENTS = "agents"
  const val CHANNEL_RUNNING = "running"
  const val REPLY_KEY = "reply"

  fun createChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannels(
      listOf(
        NotificationChannel(CHANNEL_APPROVALS, "Approvals", NotificationManager.IMPORTANCE_HIGH)
          .apply { description = "An agent is waiting for you to approve a tool." },
        NotificationChannel(CHANNEL_AGENTS, "Agent updates", NotificationManager.IMPORTANCE_DEFAULT)
          .apply { description = "An agent finished, failed or sent you a message." },
        NotificationChannel(CHANNEL_RUNNING, "Running agents", NotificationManager.IMPORTANCE_LOW)
          .apply { description = "What your agents are doing right now."; setShowBadge(false) },
      ),
    )
  }

  fun allowed(context: Context): Boolean =
    NotificationManagerCompat.from(context).areNotificationsEnabled() &&
      (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)

  /** An in-band notification; suppressed while the app is on screen, matching the desktop. */
  fun presentInBand(context: Context, payload: EventsTypes.NotificationPayload) {
    if (ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return
    post(
      context,
      SealedNotification(
        title = payload.title,
        body = payload.body,
        kind = payload.kind.rawValue,
        agentId = payload.agentId,
        sessionId = payload.sessionId,
        toolUseId = payload.toolUseId,
        actions = payload.actions.orEmpty().map { SealedNotificationAction(it.id.rawValue, it.title) },
        accountId = payload.accountId,
      ),
    )
  }

  /** The same tag the pushed copy gets, so an in-band and a pushed alert replace each other instead of stacking. */
  fun tag(notification: SealedNotification): String =
    ArgusSeal.collapseSubject(notification.kind, notification.agentId, notification.toolUseId) ?: UUID.randomUUID().toString()

  fun post(context: Context, notification: SealedNotification, tag: String = tag(notification)) {
    if (!allowed(context)) return
    val permission = notification.actions.isNotEmpty() && notification.toolUseId != null
    val builder = NotificationCompat.Builder(context, if (permission) CHANNEL_APPROVALS else CHANNEL_AGENTS)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(notification.title)
      .setContentText(notification.body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(notification.body))
      .setAutoCancel(true)
      .setCategory(if (permission) NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_STATUS)
      .setContentIntent(openIntent(context, notification, tag))
    val agentId = notification.agentId
    val switchTo = notification.accountId
    val switchAction = notification.actions.firstOrNull { it.id == NotificationAction.SWITCH_ACCOUNT }
    if (switchAction != null && switchTo != null) {
      builder.addAction(0, switchAction.title, switchIntent(context, switchTo, tag))
    } else if (permission && agentId != null) {
      for (action in notification.actions) {
        val id = action.id.takeIf { it == NotificationAction.APPROVE || it == NotificationAction.DENY } ?: continue
        builder.addAction(0, action.title, actionIntent(context, id, agentId, notification.toolUseId, tag))
      }
    } else if (agentId != null) {
      val input = RemoteInput.Builder(REPLY_KEY).setLabel("Reply to the agent").build()
      builder.addAction(
        NotificationCompat.Action.Builder(0, "Reply", actionIntent(context, NotificationActionReceiver.REPLY, agentId, null, tag, mutable = true))
          .addRemoteInput(input)
          .setAllowGeneratedReplies(false)
          .build(),
      )
    }
    // Android 13+ lets the user refuse notifications; posting then would throw.
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return
    runCatching { NotificationManagerCompat.from(context).notify(tag, 0, builder.build()) }
  }

  /** A reply from the shade that never found a connection; the agent's screen is where to retry. */
  fun replyFailed(context: Context, agentId: String) = post(
    context,
    SealedNotification(title = "Reply not sent", body = "Couldn't reach your computer. Open the agent to try again.", kind = "failed", agentId = agentId),
  )

  fun cancel(context: Context, tag: String) = NotificationManagerCompat.from(context).cancel(tag, 0)

  /** A tap opens the agent; the launch router switches computers when it belongs to another one. */
  private fun openIntent(context: Context, notification: SealedNotification, tag: String): PendingIntent {
    val intent = Intent(context, MainActivity::class.java)
      .setAction(ACTION_OPEN_NOTIFICATION)
      .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      .putExtra(NotificationExtra.AGENT_ID, notification.agentId)
      .putExtra(NotificationExtra.SESSION_ID, notification.sessionId)
      .putExtra(NotificationExtra.LABEL, notification.title)
      .putExtra(NotificationExtra.KIND, notification.kind)
    return PendingIntent.getActivity(context, tag.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun switchIntent(context: Context, accountId: String, tag: String): PendingIntent {
    val intent = Intent(context, NotificationActionReceiver::class.java)
      .setAction(NotificationAction.SWITCH_ACCOUNT)
      .putExtra(NotificationExtra.ACCOUNT_ID, accountId)
      .putExtra(NotificationActionReceiver.EXTRA_TAG, tag)
    return PendingIntent.getBroadcast(
      context, (tag + NotificationAction.SWITCH_ACCOUNT).hashCode(), intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun actionIntent(
    context: Context,
    action: String,
    agentId: String,
    toolUseId: String?,
    tag: String,
    mutable: Boolean = false,
  ): PendingIntent {
    val intent = Intent(context, NotificationActionReceiver::class.java)
      .setAction(action)
      .putExtra(NotificationExtra.AGENT_ID, agentId)
      .putExtra(NotificationExtra.TOOL_USE_ID, toolUseId)
      .putExtra(NotificationActionReceiver.EXTRA_TAG, tag)
    // RemoteInput writes the reply into the intent, which needs a mutable one.
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)
    return PendingIntent.getBroadcast(context, (tag + action).hashCode(), intent, flags)
  }

  const val ACTION_OPEN_NOTIFICATION = "dev.houwert.argus.OPEN_NOTIFICATION"
}
