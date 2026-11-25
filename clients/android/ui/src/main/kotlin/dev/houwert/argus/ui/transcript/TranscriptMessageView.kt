package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.isOptimistic
import dev.houwert.argus.core.transcript.bodyBlocks
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.kit.util.LinkedProjects
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Chip
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import java.text.DateFormat
import java.util.Date

/** One message: its text, its images, its tool calls, and whatever decision it is waiting on. */
@Composable
fun TranscriptMessageView(message: RemoteMessage, modifier: Modifier = Modifier) {
  val handoff = message.handoff
  if (handoff != null) {
    HandoffDivider(handoff, modifier)
    return
  }
  val dutyRun = message.dutyRun
  if (dutyRun != null) {
    DutyRunDivider(dutyRun, transcriptEnvironment.openDutyRun, modifier)
    return
  }
  val isUser = message.role == RemoteMessageRole.user
  if (isUser) {
    // A sent message is inset from the leading edge; a reply fills the column, as on the Mac.
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
      Spacer(Modifier.width(40.dp))
      MessageColumn(message, true, Modifier.weight(1f, fill = false))
    }
  } else {
    MessageColumn(message, false, modifier.fillMaxWidth())
  }
}

@Composable
private fun MessageColumn(message: RemoteMessage, isUser: Boolean, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val env = transcriptEnvironment
  val pending = LocalPending.current
  val align = if (isUser) Alignment.End else Alignment.Start
  val linked = remember(message) { if (isUser) LinkedProjects.parsePreamble(message.textBlocks.joinToString("\n")) else null }
  val textBlocks = remember(message) { message.bodyBlocks }
  // A call waiting on a decision sits at the transcript's foot (`TranscriptPrompts`), as on the Mac.
  val settledCalls = message.toolCalls.filter { !pending.isPending(it) }
  val hasBubble = textBlocks.isNotEmpty() || settledCalls.isNotEmpty() || message.command != null
  Column(modifier, horizontalAlignment = align, verticalArrangement = Arrangement.spacedBy(6.dp)) {
    // Attachments sit beside the bubble, not inside it, so they read as sent with it.
    val refs = message.images.orEmpty()
    if (refs.isNotEmpty()) {
      val ids = refs.map { it.imageId }
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for (ref in refs.take(3)) TranscriptImage(ref.imageId, siblings = ids, maxHeight = 140.dp)
      }
      if (refs.size > 3) Text("+${refs.size - 3} more", color = theme.textSecondary, style = argusFont(12))
    }
    if (hasBubble) {
      Column(
        // Only the user's bubble has a shape; clipping the bare reply would cut its first letter's corner.
        if (isUser) Modifier.clip(RoundedCornerShape(ArgusMetrics.radius)).background(theme.accentSoft).padding(11.dp) else Modifier,
        horizontalAlignment = align,
        verticalArrangement = Arrangement.spacedBy(6.dp),
      ) {
        message.command?.let { CommandChip(it, Modifier.messageMenu(env.messageMenu, message), size = 13) }
        if (textBlocks.isNotEmpty()) {
          // On the text alone: a long press on a tool card or its prompt isn't about the message.
          Column(Modifier.messageMenu(env.messageMenu, message), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (block in textBlocks) MarkdownView(block, baseSize = 15, mentions = isUser)
          }
        }
        for (call in settledCalls) ToolCallCard(call)
      }
    }
    val source = message.source
    if (message.isError == true || source != null || message.author != null) {
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (source != null) Badge(source.parentLabel?.let { "$it → ${source.tool}" } ?: "MCP · ${source.tool}")
        message.author?.let { Badge(it) }
        if (message.isError == true) Badge("error", tone = Tone.Danger)
      }
    }
    val paths = linked?.paths.orEmpty()
    if (paths.isNotEmpty()) {
      Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for (path in paths) Chip(path.substringAfterLast('/').ifEmpty { path }, icon = Icon.folder)
      }
    }
    if (HostStore.isOptimistic(message.id)) {
      SendingLabel()
    } else {
      message.timestamp?.let {
        Text(
          DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it.toLong())),
          color = theme.textMuted.copy(alpha = theme.textMuted.alpha * 0.7f), style = argusFont(11),
        )
      }
    }
  }
}

/** Stands in for the timestamp until the computer has the message. */
@Composable
internal fun SendingLabel() {
  val theme = ArgusTheme.colors
  Row(Modifier.semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
    CircularProgressIndicator(Modifier.size(9.dp), color = theme.textMuted, strokeWidth = 1.5.dp)
    Text("Sending", color = theme.textMuted, style = argusFont(11))
  }
}
