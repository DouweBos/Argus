package dev.houwert.argus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.git.DiffReviewComment
import dev.houwert.argus.core.git.DiffReviewPrompt
import dev.houwert.argus.core.git.LineAuthor
import dev.houwert.argus.kit.util.DiffFile
import dev.houwert.argus.kit.util.DiffHunk
import dev.houwert.argus.kit.util.DiffLine
import dev.houwert.argus.kit.util.DiffLineKind
import dev.houwert.argus.ui.icons.Icon as Icons
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/**
 * A file's hunks with a row per line, so a tap comments on it; drafts sit under their lines.
 * Lines wrap rather than scroll sideways, which keeps each comment beside what it's about.
 */
@Composable
fun ReviewableDiffHunksView(
  file: DiffFile,
  comments: List<DiffReviewComment>,
  onTapLine: (DiffHunk, DiffLine) -> Unit,
  onEdit: (DiffReviewComment) -> Unit,
  onDelete: (DiffReviewComment) -> Unit,
  modifier: Modifier = Modifier,
  attribution: Map<Int, LineAuthor> = emptyMap(),
) {
  val theme = ArgusTheme.colors
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    if (file.isBinary) {
      MutedText("Binary file, nothing to show.")
      return@Column
    }
    for (hunk in file.hunks) {
      Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(ArgusMetrics.radiusSmall))) {
        DiffHunkHeader(hunk.header)
        for (line in hunk.lines) {
          val interaction = rememberInteraction()
          Row(
            Modifier.fillMaxWidth()
              .background(DiffColors.band(line.kind, theme))
              .argusClickable(interaction, label = "Comment on this line") { onTapLine(hunk, line) }
              .padding(vertical = 1.dp)
              .padding(end = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
          ) {
            val number = (if (line.kind == DiffLineKind.REMOVE) line.oldNumber else line.newNumber)?.toString() ?: ""
            Text(number.padStart(4), Modifier.widthIn(min = 34.dp), color = theme.textMuted, style = argusFont(11, mono = true))
            if (attribution.isNotEmpty()) AttributionMark(line.author(attribution))
            Text(
              DiffColors.sign(line.kind) + line.text, Modifier.weight(1f), color = DiffColors.text(line.kind, theme),
              style = argusFont(11.5f, mono = true),
            )
          }
          for (comment in comments.filter { it.anchors(file.displayPath, line) }) {
            DiffCommentBubble(comment, { onEdit(comment) }, { onDelete(comment) }, Modifier.padding(6.dp))
          }
        }
      }
    }
  }
}

/** A draft comment under its line. */
@Composable
fun DiffCommentBubble(comment: DiffReviewComment, onEdit: () -> Unit, onDelete: () -> Unit, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  Column(
    modifier.fillMaxWidth().clip(shape).background(theme.surface).border(1.dp, theme.accentBorder, shape).padding(10.dp),
    verticalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(Icons.chat, null, Modifier.size(14.dp), tint = theme.accent)
      Text("Draft comment", Modifier.weight(1f), color = theme.text, style = argusFont(12, FontWeight.SemiBold))
      AccentLink("Edit", size = 13, onClick = onEdit)
      AccentLink("Delete", size = 13, onClick = onDelete)
    }
    Text(comment.body, color = theme.text, style = argusFont(13))
  }
}

/** A review's drafts under the screen: how many, on how many files, discard, and the primary action. */
@Composable
fun ReviewDraftBar(
  comments: List<DiffReviewComment>,
  actionLabel: String,
  modifier: Modifier = Modifier,
  busy: Boolean = false,
  emptyTitle: String? = null,
  emptyHint: String? = null,
  onDiscard: () -> Unit,
  onAction: () -> Unit,
) {
  val theme = ArgusTheme.colors
  Column(modifier.fillMaxWidth().background(theme.bgSecondary)) {
    HorizontalDivider(color = theme.border, thickness = 0.5.dp)
    Row(
      Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
      horizontalArrangement = Arrangement.spacedBy(10.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        val files = comments.map { it.path }.toSet().size
        Text(
          if (comments.isEmpty() && emptyTitle != null) emptyTitle else DiffReviewPrompt.plural(comments.size, "comment"),
          color = theme.text, style = argusFont(14, FontWeight.SemiBold),
        )
        MutedText(if (comments.isEmpty() && emptyHint != null) emptyHint else "on ${DiffReviewPrompt.plural(files, "file")}")
      }
      if (comments.isNotEmpty()) Btn("Discard", tone = ButtonTone.Ghost, small = true, hugs = true, onClick = onDiscard)
      Btn(actionLabel, small = true, hugs = true, icon = Icons.send, busy = busy, onClick = onAction)
    }
  }
}
