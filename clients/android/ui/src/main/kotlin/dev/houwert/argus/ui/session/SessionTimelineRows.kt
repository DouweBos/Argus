package dev.houwert.argus.ui.session

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.git.TimelineRestore
import dev.houwert.argus.core.git.TimelineTurn
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.ChangeCounts
import dev.houwert.argus.ui.icons.Icon as Glyph
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

object TimelineText {
  fun files(count: Int) = if (count == 1) "1 file" else "$count files"

  fun restoreDetail(restore: TimelineRestore, now: Double = System.currentTimeMillis().toDouble()): String {
    val restored = Labels.timeAgo(restore.timestamp, now)
    val undone = restore.undoneAt ?: return "Files only, the conversation stays · $restored"
    return "Undone ${Labels.timeAgo(undone, now)} · $restored"
  }
}

/**
 * One agent turn on a session's timeline: its number, the prompt's first line,
 * then the agent, when, and what it changed.
 */
@Composable
fun TimelineTurnRow(turn: TimelineTurn, modifier: Modifier = Modifier, compact: Boolean = false) {
  val theme = ArgusTheme.colors
  Row(modifier.semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
    Text(
      turn.number.toString(),
      Modifier.widthIn(min = 20.dp).padding(top = 2.dp),
      style = argusFont(11, mono = true),
      color = theme.textMuted,
      textAlign = TextAlign.End,
    )
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(if (compact) 3.dp else 4.dp)) {
      Row(verticalAlignment = Alignment.Top) {
        Text(
          turn.prompt.ifEmpty { "No text" },
          Modifier.weight(1f),
          style = argusFont(if (compact) 13 else 15),
          color = if (turn.available) theme.text else theme.textMuted,
          maxLines = if (compact) 1 else 2,
          overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.size(6.dp))
        Text(Labels.timeAgo(turn.timestamp), style = argusFont(11), color = theme.textMuted, maxLines = 1)
      }
      TurnMeta(turn)
    }
  }
}

@Composable
private fun TurnMeta(turn: TimelineTurn) {
  val theme = ArgusTheme.colors
  val style = argusFont(11)
  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
    turn.agentTitle?.let { title ->
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        Icon(Glyph.agent, null, Modifier.size(11.dp), tint = theme.textSecondary)
        Text(title, style = style, color = theme.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
    }
    when {
      !turn.available -> Badge("Checkpoint gone")
      !turn.finished -> Badge("Running", tone = Tone.Accent)
      turn.files == 0 -> Text("No file changes", style = style, color = theme.textSecondary)
      else -> {
        Text(TimelineText.files(turn.files), style = style, color = theme.textSecondary, maxLines = 1)
        ChangeCounts(turn.additions, turn.deletions)
      }
    }
  }
}

/** The files put back to where a turn ended, between the turns on the timeline. */
@Composable
fun TimelineRestoreRow(restore: TimelineRestore, modifier: Modifier = Modifier, undo: (() -> Unit)? = null) {
  val theme = ArgusTheme.colors
  val undone = restore.undoneAt != null
  Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
    Icon(
      Glyph.restoreVersion,
      null,
      Modifier.widthIn(min = 20.dp).size(14.dp),
      tint = if (undone) theme.textMuted else theme.accent,
    )
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
      Text(
        "Restored to the end of turn ${restore.turnNumber}",
        style = argusFont(13, FontWeight.Medium).copy(textDecoration = if (undone) TextDecoration.LineThrough else null),
        color = if (undone) theme.textMuted else theme.text,
      )
      Text(TimelineText.restoreDetail(restore), style = argusFont(11), color = theme.textMuted)
    }
    if (undo != null) Btn("Undo restore", tone = ButtonTone.Ghost, small = true, icon = Glyph.undo, hugs = true, onClick = undo)
  }
}
