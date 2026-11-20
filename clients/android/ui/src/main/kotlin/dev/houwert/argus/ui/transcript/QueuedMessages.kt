package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.FailedSend
import dev.houwert.argus.core.stores.discardFailed
import dev.houwert.argus.core.stores.discardHeld
import dev.houwert.argus.core.stores.removeQueued
import dev.houwert.argus.core.stores.retryFailed
import dev.houwert.argus.core.stores.seedImage
import dev.houwert.argus.core.stores.sendQueuedNow
import dev.houwert.argus.core.stores.updateQueued
import dev.houwert.argus.kit.protocol.generated.RemoteQueuedMessage
import dev.houwert.argus.kit.util.LinkedProjects
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.BodyText
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.FormSheet
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/**
 * A message the computer never received, as its own card rather than a bubble: a bubble reads as
 * delivered. [waiting]: in the outbox, it goes on its own once connected, so there's nothing to retry.
 */
@Composable
fun FailedSendCard(item: FailedSend, modifier: Modifier = Modifier, waiting: Boolean = false) {
  val env = transcriptEnvironment
  // The attachments travel as base64; seeded into the transcript's cache, they render as usual.
  val ids = remember(item.id, item.images.size) { item.images.indices.map { "failed:${item.id}:img:$it" } }
  LaunchedEffect(item.id) {
    item.images.forEachIndexed { index, image ->
      env.host.seedImage(env.agentKey, ids[index], "data:${image.mediaType};base64,${image.data}")
    }
  }
  Card(modifier) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Badge(if (waiting) "Waiting" else "Not sent", Modifier.padding(top = 3.dp), tone = if (waiting) Tone.Warning else Tone.Danger)
      BodyText(item.text, Modifier.weight(1f).padding(top = 1.dp))
      if (waiting) {
        IconBtn(Icon.close, "Don't send", Modifier.size(32.dp), size = 14.dp) { env.host.discardHeld(env.agentKey, item.id) }
      } else {
        IconBtn(Icon.refresh, "Send again", Modifier.size(32.dp), size = 14.dp) {
          env.scope.launch { env.host.retryFailed(env.agentKey, item.id) }
        }
        IconBtn(Icon.close, "Discard message", Modifier.size(32.dp), size = 14.dp) { env.host.discardFailed(env.agentKey, item.id) }
      }
    }
    if (ids.isNotEmpty()) {
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { for (id in ids) TranscriptImage(id, siblings = ids, maxHeight = 56.dp) }
    }
  }
}

/** A message still waiting to be sent: editable in place, because a phone is usually where you notice the typo. */
@Composable
fun QueuedMessageCard(message: RemoteQueuedMessage, modifier: Modifier = Modifier, sending: Boolean = false) {
  val env = transcriptEnvironment
  val host = env.host
  val capabilities by host.capabilities.collectAsState()
  // The stored text carries the linked-projects preamble; the editor only shows what was typed.
  val parsed = remember(message.text) { LinkedProjects.parsePreamble(message.text) }
  val displayText = parsed?.rest ?: message.displayText ?: message.text
  val ids = remember(message.id, message.images?.size) { message.images.orEmpty().indices.map { "queued:${message.id}:img:$it" } }
  var editing by remember { mutableStateOf(false) }
  var confirmingRemove by remember { mutableStateOf(false) }
  LaunchedEffect(message.id) {
    message.images.orEmpty().forEachIndexed { index, image ->
      host.seedImage(env.agentKey, ids[index], "data:${image.mediaType};base64,${image.data}")
    }
  }
  Card(modifier) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
      Badge(if (sending) "Sending" else "Queued", Modifier.padding(top = 3.dp))
      BodyText(displayText, Modifier.weight(1f).padding(top = 1.dp))
      if (sending) {
        CircularProgressIndicator(Modifier.size(12.dp), color = ArgusTheme.colors.textMuted, strokeWidth = 1.5.dp)
      } else {
        if ("control" in capabilities) {
          IconBtn(Icon.send, "Send now, into the agent's current turn", Modifier.size(32.dp), size = 15.dp) {
            env.scope.launch { host.sendQueuedNow(env.agentKey, message.id) }
          }
        }
        IconBtn(Icon.pencil, "Edit queued message", Modifier.size(32.dp), size = 14.dp) { editing = true }
        IconBtn(Icon.close, "Remove queued message", Modifier.size(32.dp), size = 14.dp) { confirmingRemove = true }
      }
    }
    if (ids.isNotEmpty()) {
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { for (id in ids) TranscriptImage(id, siblings = ids, maxHeight = 56.dp) }
    }
  }
  // A sheet, not an inline field: the transcript follows the newest message and would steal the cursor.
  if (editing) {
    QueuedMessageEditor(displayText, onDismiss = { editing = false }) { draft ->
      val trimmed = draft.trim()
      val paths = parsed?.paths.orEmpty()
      env.scope.launch {
        // Cleared to nothing with no projects attached is a delete: there'd be no message left to send.
        if (trimmed.isEmpty() && paths.isEmpty()) {
          host.removeQueued(env.agentKey, message.id)
        } else {
          host.updateQueued(env.agentKey, message.id, LinkedProjects.buildPreamble(paths, trimmed))
        }
      }
    }
  }
  if (confirmingRemove) {
    ConfirmDialog(
      "Remove this queued message?", displayText.take(120), "Remove",
      onConfirm = { env.scope.launch { host.removeQueued(env.agentKey, message.id) } },
      onDismiss = { confirmingRemove = false },
      destructive = true,
    )
  }
}

/** Editing one queued message, over the transcript rather than inside it. */
@Composable
fun QueuedMessageEditor(initial: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
  var text by rememberSaveable { mutableStateOf(initial) }
  val focus = remember { FocusRequester() }
  LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
  FormSheet("Edit Queued Message", onDismiss, confirmLabel = "Save", onConfirm = {
    onSave(text)
    onDismiss()
  }) {
    Field("Message", caption = "Sent when the agent finishes its turn.") {
      ThemedTextField(text, { text = it }, "Message", Modifier.focusRequester(focus), multiline = true, lines = 4..16)
    }
  }
}
