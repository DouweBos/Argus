package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.houwert.argus.kit.util.DiffFile
import dev.houwert.argus.kit.util.DiffLine
import dev.houwert.argus.kit.util.DiffLineKind
import dev.houwert.argus.ui.components.AccentLink
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.theme.ArgusColors
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

private const val COLLAPSED_COUNT = 12

/**
 * Diff lines with a line-number gutter, collapsed past a dozen rows. One text for every line with
 * its bands drawn behind: a composable per line made a diff the costliest row in a scrolling chat.
 */
@Composable
fun DiffLinesView(lines: List<DiffLine>, modifier: Modifier = Modifier, collapses: Boolean = true) {
  val theme = ArgusTheme.colors
  var showAll by rememberSaveable { mutableStateOf(false) }
  val visible = if (showAll || !collapses) lines else lines.take(COLLAPSED_COUNT)
  val text = remember(visible, theme) { diffText(visible, theme) }
  val bands = remember(visible, theme) { visible.map { band(it, theme) } }
  var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
  Column(modifier) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
      val room = maxWidth
      Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
      Text(
        text,
        // At least the card's width, so a band runs edge to edge under a short line.
        Modifier.widthIn(min = room).padding(vertical = 1.dp).drawBehind {
          val result = layout ?: return@drawBehind
          for (index in 0 until minOf(result.lineCount, bands.size)) {
            val color = bands[index]
            if (color == Color.Transparent) continue
            val top = result.getLineTop(index)
            drawRect(color, Offset(0f, top), Size(size.width, result.getLineBottom(index) - top))
          }
        },
        softWrap = false,
        style = argusFont(11.5f, mono = true).copy(lineHeight = 16.sp),
        onTextLayout = { layout = it },
      )
      }
    }
    if (collapses && lines.size > COLLAPSED_COUNT) {
      AccentLink(
        if (showAll) "Collapse" else "See all ${lines.size} lines",
        Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
        size = 12,
      ) { showAll = !showAll }
    }
  }
}

private fun diffText(visible: List<DiffLine>, theme: ArgusColors) = buildAnnotatedString {
  visible.forEachIndexed { index, line ->
    val number = gutter(line)
    withStyle(SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = theme.textMuted)) {
      append(" ".repeat(maxOf(0, 5 - number.length)) + number + " ")
    }
    withStyle(SpanStyle(color = color(line, theme))) {
      append(prefix(line) + line.text + if (index < visible.size - 1) "\n" else "")
    }
  }
}

private fun gutter(line: DiffLine): String = when (line.kind) {
  DiffLineKind.ADD, DiffLineKind.CONTEXT -> line.newNumber?.toString().orEmpty()
  DiffLineKind.REMOVE -> line.oldNumber?.toString().orEmpty()
  DiffLineKind.NO_NEWLINE -> ""
}

private fun prefix(line: DiffLine): String = when (line.kind) {
  DiffLineKind.ADD -> "+"
  DiffLineKind.REMOVE -> "-"
  DiffLineKind.CONTEXT -> " "
  DiffLineKind.NO_NEWLINE -> "\\"
}

private fun color(line: DiffLine, theme: ArgusColors): Color = when (line.kind) {
  DiffLineKind.ADD -> theme.success
  DiffLineKind.REMOVE -> theme.error
  DiffLineKind.CONTEXT -> theme.textSecondary
  DiffLineKind.NO_NEWLINE -> theme.textMuted
}

private fun band(line: DiffLine, theme: ArgusColors): Color = when (line.kind) {
  DiffLineKind.ADD -> theme.successSoft
  DiffLineKind.REMOVE -> theme.errorSoft
  else -> Color.Transparent
}

/** A file's hunks, each under its `@@` header; "nothing to show" for a binary. */
@Composable
fun DiffHunksView(file: DiffFile, modifier: Modifier = Modifier, collapsesLongHunks: Boolean = true) {
  val theme = ArgusTheme.colors
  if (file.isBinary) {
    MutedText("Binary file, nothing to show.", modifier)
    return
  }
  Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
    for (hunk in file.hunks) {
      Column(Modifier.clip(RoundedCornerShape(ArgusMetrics.radiusSmall))) {
        Text(
          hunk.header,
          Modifier.fillMaxWidth().background(theme.bgTertiary).padding(horizontal = 6.dp, vertical = 4.dp),
          color = theme.textMuted,
          style = argusFont(11, mono = true),
        )
        DiffLinesView(hunk.lines, collapses = collapsesLongHunks)
      }
    }
  }
}
