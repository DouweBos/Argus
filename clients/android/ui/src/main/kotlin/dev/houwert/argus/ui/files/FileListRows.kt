package dev.houwert.argus.ui.files

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.code.FuzzyFileMatcher
import dev.houwert.argus.core.files.SessionFilePaths
import dev.houwert.argus.kit.protocol.generated.CodeSearchMatch
import dev.houwert.argus.ui.icons.FileTypeIcon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** A quick-open result: the file name, its directory, the matched letters in accent. */
@Composable
fun FuzzyFileRow(match: FuzzyFileMatcher.Match, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val path = match.path
  val nameStart = path.length - SessionFilePaths.fileName(path).length
  Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
    FileTypeIcon(path)
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(
        highlighted(path, match.indices, nameStart, path.length, theme.text, theme.accent),
        style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis,
      )
      if (nameStart > 0) {
        Text(
          highlighted(path, match.indices, 0, nameStart - 1, theme.textSecondary, theme.accent),
          style = ArgusTheme.typography.caption, maxLines = 1, overflow = TextOverflow.StartEllipsis,
        )
      }
    }
    if (match.isBoosted) Text("Changed", color = theme.warning, style = ArgusTheme.typography.caption)
  }
}

/** `path[from until to]` with the matched letters picked out. */
internal fun highlighted(path: String, indices: List<Int>, from: Int, to: Int, base: Color, hit: Color): AnnotatedString {
  val hits = indices.toSet()
  return buildAnnotatedString {
    for (i in from until maxOf(from, to)) {
      if (i in hits) {
        pushStyle(SpanStyle(color = hit, fontWeight = FontWeight.Bold))
        append(path[i])
        pop()
      } else {
        pushStyle(SpanStyle(color = base))
        append(path[i])
        pop()
      }
    }
  }
}

/** A worktree-search file group's header: the file's name, its directory and how many hits it holds. */
@Composable
fun FileSearchGroupHeader(path: String, count: Int, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val name = SessionFilePaths.fileName(path)
  val directory = SessionFilePaths.directory(path)
  Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
    FileTypeIcon(path)
    Text(name, color = theme.text, style = argusFont(15, FontWeight.SemiBold), maxLines = 1)
    Text(
      directory, Modifier.weight(1f), color = theme.textSecondary, style = ArgusTheme.typography.footnote,
      maxLines = 1, overflow = TextOverflow.StartEllipsis,
    )
    Text("$count", color = theme.textSecondary, style = ArgusTheme.typography.footnote)
  }
}

/** One worktree-search hit: its line number and the preview with the match picked out. */
@Composable
fun FileSearchMatchRow(match: CodeSearchMatch, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val preview = match.preview
  val start = (match.column - match.previewOffset).toInt().coerceIn(0, preview.length)
  val end = (start + maxOf(0, match.length.toInt())).coerceAtMost(preview.length)
  val trimmed = preview.substring(0, start).let { it.length - it.trimStart(' ', '\t').length }
  val text = buildAnnotatedString {
    pushStyle(SpanStyle(color = theme.textSecondary)); append(preview.substring(trimmed, start)); pop()
    pushStyle(SpanStyle(color = theme.text, background = theme.accentSoft)); append(preview.substring(start, end)); pop()
    pushStyle(SpanStyle(color = theme.textSecondary)); append(preview.substring(end)); pop()
  }
  Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    Text("${match.line}", Modifier.widthIn(min = 28.dp), color = theme.textMuted, style = argusFont(11, mono = true), textAlign = TextAlign.End)
    Text(text, style = argusFont(12, mono = true), maxLines = 2, overflow = TextOverflow.Ellipsis)
  }
}
