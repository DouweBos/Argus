package dev.houwert.argus.ui.code

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.syntax.CodeHighlighting
import dev.houwert.argus.ui.syntax.SyntaxHighlighter
import dev.houwert.argus.ui.syntax.SyntaxLanguage
import dev.houwert.argus.ui.syntax.SyntaxLimits
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * A read-only code viewer: line-virtualised, line numbers, syntax colours, sideways scrolling for
 * long lines. Shows plain text at once and recolours when the off-main parse lands.
 *
 * Set [focusLine] (1-based) to scroll to a line and tint it; changing it scrolls again.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun CodeView(
  text: String,
  language: SyntaxLanguage?,
  modifier: Modifier = Modifier,
  focusLine: Int? = null,
  fontSize: Float = 12f,
  /** The number of the first line, for a page out of a larger file. */
  firstLine: Long = 1,
) {
  val theme = ArgusTheme.colors
  val palette = theme.syntax
  val lines = remember(text) { CodeHighlighting.lineRanges(text).map { text.substring(it.first, it.last + 1) } }
  val disabled = remember(text) { SyntaxLimits.highlightingDisabledReason(text.toByteArray().size, text) }
  val highlighted by produceState<List<AnnotatedString>?>(null, text, language, palette) {
    value = null
    if (language == null || disabled != null) return@produceState
    value = withContext(Dispatchers.Default) {
      CodeHighlighting.annotatedLines(text, SyntaxHighlighter.highlight(text, language), palette)
    }
  }
  val style = argusFont(fontSize, mono = true)
  val measurer = rememberTextMeasurer()
  val density = LocalDensity.current
  val charWidth = remember(style, density) { with(density) { measurer.measure("0", style).size.width.toDp() } }
  val longest = remember(lines) { lines.maxOfOrNull { it.length } ?: 0 }
  val gutter = charWidth * maxOf(2, (lines.size + firstLine - 1).toString().length)
  val contentWidth = gutter + 36.dp + charWidth * longest
  val listState = rememberLazyListState()
  val clipboard = LocalClipboardManager.current

  LaunchedEffect(focusLine, lines.size) {
    val line = focusLine ?: return@LaunchedEffect
    if (line in 1..lines.size) listState.scrollToItem(maxOf(0, line - 1 - 8))
  }

  Column(modifier.fillMaxSize().background(theme.bg)) {
    if (disabled != null) {
      Text(
        if (disabled == SyntaxLimits.DisabledReason.TooLarge) "Highlighting is off for files over 2 MB." else "Highlighting is off for files with very long lines.",
        Modifier.fillMaxWidth().background(theme.bgSecondary).padding(horizontal = 10.dp, vertical = 6.dp),
        color = theme.textSecondary, style = argusFont(12),
      )
    }
    Box(Modifier.fillMaxSize().horizontalScroll(rememberScrollState())) {
      LazyColumn(Modifier.width(maxOf(contentWidth, 1.dp)).fillMaxSize(), state = listState, contentPadding = PaddingValues(vertical = 6.dp)) {
        items(lines.size) { index ->
          val number = index + firstLine
          val focused = number == focusLine?.toLong()
          var menu by remember { mutableStateOf(false) }
          Row(
            Modifier.fillMaxWidth()
              .background(if (focused) theme.accentSoft else Color.Transparent)
              .combinedClickable(onClickLabel = null, onLongClickLabel = "Copy", onLongClick = { menu = true }) {}
              .padding(start = 8.dp),
          ) {
            Text(
              "$number", Modifier.width(gutter).padding(end = 0.dp), color = if (focused) theme.text else theme.textMuted,
              style = style, textAlign = TextAlign.End, maxLines = 1, softWrap = false,
            )
            val line = highlighted?.getOrNull(index)
            if (line != null) {
              Text(line, Modifier.padding(start = 12.dp, end = 16.dp), color = palette.variable, style = style, softWrap = false, maxLines = 1)
            } else {
              Text(lines[index], Modifier.padding(start = 12.dp, end = 16.dp), color = theme.text, style = style, softWrap = false, maxLines = 1)
            }
            DropdownMenu(menu, { menu = false }) {
              DropdownMenuItem({ Text("Copy Line") }, { clipboard.setText(AnnotatedString(lines[index])); menu = false })
              DropdownMenuItem({ Text("Copy All") }, { clipboard.setText(AnnotatedString(text)); menu = false })
            }
          }
        }
      }
    }
  }
}
