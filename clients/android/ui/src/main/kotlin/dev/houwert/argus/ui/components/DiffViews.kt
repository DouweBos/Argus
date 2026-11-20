package dev.houwert.argus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.protocol.generated.RemoteViewedFileState
import dev.houwert.argus.kit.util.DiffFile
import dev.houwert.argus.kit.util.DiffFileStatus
import dev.houwert.argus.kit.util.DiffLine
import dev.houwert.argus.kit.util.DiffLineKind
import dev.houwert.argus.ui.icons.FileTypeIcon
import dev.houwert.argus.ui.icons.Icon as Icons
import dev.houwert.argus.ui.icons.SfSymbol
import dev.houwert.argus.ui.theme.ArgusColors
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

val DiffFileStatus.tone: Tone
  get() = when (this) {
    DiffFileStatus.ADDED -> Tone.Success
    DiffFileStatus.DELETED -> Tone.Danger
    else -> Tone.Accent
  }

/** Where "View file" opens: the first added line, else the first line shown. */
val DiffFile.firstChangedLine: Int?
  get() = hunks.asSequence().flatMap { it.lines }.firstOrNull { it.kind == DiffLineKind.ADD }?.newNumber
    ?: hunks.firstOrNull()?.lines?.firstOrNull()?.newNumber

/** A changed file as a list row: icon, path, counts, what happened to it, and its viewed mark. */
@Composable
fun ChangedFileRow(
  file: DiffFile,
  modifier: Modifier = Modifier,
  showsChevron: Boolean = true,
  viewedState: RemoteViewedFileState? = null,
) {
  val theme = ArgusTheme.colors
  Row(
    modifier.fillMaxWidth().alpha(if (viewedState == RemoteViewedFileState.viewed) 0.6f else 1f),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    FileTypeIcon(file.displayPath, size = 14.dp)
    MonoText(file.displayPath, Modifier.weight(1f), size = 12, color = theme.text, maxLines = 1, truncateHead = true)
    ChangeCounts(file.additions, file.deletions)
    Badge(file.status.label, tone = file.status.tone)
    when (viewedState) {
      RemoteViewedFileState.viewed -> Icon(Icons.done, "Viewed", Modifier.size(16.dp), tint = theme.textMuted)
      RemoteViewedFileState.changed -> Icon(SfSymbol["circle.lefthalf.filled"], "Changed since viewed", Modifier.size(16.dp), tint = theme.warning)
      else -> Unit
    }
    if (showsChevron) Icon(Icons.chevronRight, null, Modifier.size(12.dp), tint = theme.textMuted)
  }
}

/** One file's diff, collapsed until you ask for it; a viewed one folds away, as on GitHub. */
@Composable
fun FileDiffCard(
  file: DiffFile,
  modifier: Modifier = Modifier,
  viewedState: RemoteViewedFileState? = null,
  /** Null where the diff keeps no viewed marks; a no-op shows the mark without letting it change. */
  onViewedChange: ((Boolean) -> Unit)? = null,
  showsViewed: Boolean = false,
  onViewFile: ((Int?) -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  var expanded by rememberSaveable(file.displayPath) { mutableStateOf(false) }
  Card(modifier) {
    val interaction = rememberInteraction()
    Row(
      Modifier.fillMaxWidth()
        .argusClickable(interaction, label = if (expanded) "Collapse ${file.displayPath}" else "Expand ${file.displayPath}") { expanded = !expanded }
        .alpha(if (viewedState == RemoteViewedFileState.viewed) 0.6f else 1f),
      horizontalArrangement = Arrangement.spacedBy(8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(if (expanded) Icons.chevronDown else Icons.chevronRight, null, Modifier.size(11.dp), tint = theme.textMuted)
      FileTypeIcon(file.displayPath, size = 14.dp)
      MonoText(file.displayPath, Modifier.weight(1f), size = 12, color = theme.text, maxLines = 1, truncateHead = true)
      ChangeCounts(file.additions, file.deletions)
      Badge(file.status.label, tone = file.status.tone)
    }
    if (showsViewed) {
      ViewedToggle(viewedState, onViewedChange?.let { change -> { on: Boolean -> if (on) expanded = false; change(on) } })
    }
    if (file.status == DiffFileStatus.RENAMED) MutedText("from ${file.oldPath}", maxLines = 1)
    if (onViewFile != null && file.status != DiffFileStatus.DELETED) {
      AccentLink("View file", size = 12) { onViewFile(file.firstChangedLine) }
    }
    if (expanded) DiffHunksView(file)
  }
}

/** A file's hunks, each under its `@@` header; "nothing to show" for a binary. */
@Composable
fun DiffHunksView(file: DiffFile, modifier: Modifier = Modifier, collapsesLongHunks: Boolean = true) {
  val theme = ArgusTheme.colors
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    if (file.isBinary) {
      MutedText("Binary file, nothing to show.")
    } else {
      for (hunk in file.hunks) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(ArgusMetrics.radiusSmall))) {
          DiffHunkHeader(hunk.header)
          DiffLinesView(hunk.lines, collapses = collapsesLongHunks)
        }
      }
    }
  }
}

@Composable
internal fun DiffHunkHeader(header: String) {
  val theme = ArgusTheme.colors
  Text(
    header,
    Modifier.fillMaxWidth().background(theme.bgTertiary).padding(horizontal = 6.dp, vertical = 4.dp),
    color = theme.textMuted, style = argusFont(11, mono = true), maxLines = 1, overflow = TextOverflow.Ellipsis,
  )
}

/** Diff lines with a line-number gutter, scrolling sideways, collapsed past a dozen rows. */
@Composable
fun DiffLinesView(lines: List<DiffLine>, modifier: Modifier = Modifier, collapses: Boolean = true) {
  val theme = ArgusTheme.colors
  var showAll by remember(lines) { mutableStateOf(false) }
  val visible = if (showAll || !collapses) lines else lines.take(COLLAPSED_COUNT)
  Column(modifier.fillMaxWidth()) {
    // Bands as wide as the widest line (at least the card), so a scrolled row keeps its tint.
    BoxWithConstraints(Modifier.fillMaxWidth()) {
    val minWidth = maxWidth
    Column(Modifier.horizontalScroll(rememberScrollState()).widthIn(min = minWidth).width(IntrinsicSize.Max)) {
      for (line in visible) {
        Row(Modifier.fillMaxWidth().background(DiffColors.band(line.kind, theme)).padding(vertical = 1.dp)) {
          Text(
            DiffColors.gutter(line).padStart(5) + " ", color = theme.textMuted, style = argusFont(11, mono = true), softWrap = false,
          )
          Text(
            DiffColors.sign(line.kind) + line.text, Modifier.padding(end = 8.dp), color = DiffColors.text(line.kind, theme),
            style = argusFont(11.5f, mono = true), softWrap = false,
          )
        }
      }
    }
    }
    if (collapses && lines.size > COLLAPSED_COUNT) {
      AccentLink(if (showAll) "Collapse" else "See all ${lines.size} lines", Modifier.padding(horizontal = 4.dp), size = 12) { showAll = !showAll }
    }
  }
}

private const val COLLAPSED_COUNT = 12

/** How a diff line reads: its gutter number, sign and colours. */
object DiffColors {
  fun gutter(line: DiffLine): String = when (line.kind) {
    DiffLineKind.REMOVE -> line.oldNumber?.toString() ?: ""
    DiffLineKind.NO_NEWLINE -> ""
    else -> line.newNumber?.toString() ?: ""
  }

  fun sign(kind: DiffLineKind): String = when (kind) {
    DiffLineKind.ADD -> "+"
    DiffLineKind.REMOVE -> "-"
    DiffLineKind.CONTEXT -> " "
    DiffLineKind.NO_NEWLINE -> "\\"
  }

  fun text(kind: DiffLineKind, theme: ArgusColors): Color = when (kind) {
    DiffLineKind.ADD -> theme.success
    DiffLineKind.REMOVE -> theme.error
    DiffLineKind.CONTEXT -> theme.textSecondary
    DiffLineKind.NO_NEWLINE -> theme.textMuted
  }

  fun band(kind: DiffLineKind, theme: ArgusColors): Color = when (kind) {
    DiffLineKind.ADD -> theme.successSoft
    DiffLineKind.REMOVE -> theme.errorSoft
    else -> Color.Transparent
  }
}

/** "Viewed" as a tick, with "Changed since viewed" once the file moved on after it. Null [onChange] shows it read-only. */
@Composable
fun ViewedToggle(state: RemoteViewedFileState?, onChange: ((Boolean) -> Unit)?, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val viewed = state == RemoteViewedFileState.viewed
  Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
    val interaction = rememberInteraction()
    Row(
      Modifier.clip(RoundedCornerShape(6.dp))
        .argusToggleable(viewed, interaction, enabled = onChange != null) { onChange?.invoke(it) }
        .padding(vertical = 4.dp, horizontal = 2.dp),
      horizontalArrangement = Arrangement.spacedBy(5.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(if (viewed) Icons.done else SfSymbol["circle"], null, Modifier.size(15.dp), tint = if (viewed) theme.accent else theme.textSecondary)
      Text("Viewed", color = if (viewed) theme.accent else theme.textSecondary, style = argusFont(12, FontWeight.Medium))
    }
    if (state == RemoteViewedFileState.changed) Badge("Changed since viewed", tone = Tone.Warning)
  }
}

/** "12 of 40 viewed" over a thin bar. */
@Composable
fun ViewedProgressBar(viewed: Int, total: Int, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Column(
    modifier.fillMaxWidth().semantics(mergeDescendants = true) { stateDescription = "$viewed of $total viewed" },
    verticalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    MutedText("$viewed of $total viewed")
    LinearProgressIndicator(
      progress = { viewed.toFloat() / total.coerceAtLeast(1) },
      Modifier.fillMaxWidth(),
      color = theme.accent,
      trackColor = theme.bgTertiary,
      drawStopIndicator = {},
    )
  }
}

/** A commit in a list: subject, short hash, author and age. */
@Composable
fun CommitRow(subject: String, hash: String, author: String, age: String?, modifier: Modifier = Modifier, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  Card(modifier.semantics(mergeDescendants = true) { contentDescription = "$subject, $author" }, onClick = onClick) {
    BodyText(subject, maxLines = 2)
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
      MonoText(hash.take(8), size = 11, color = theme.textMuted)
      MutedText(author, Modifier.weight(1f), maxLines = 1)
      if (age != null) MutedText(age)
    }
  }
}
