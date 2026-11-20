package dev.houwert.argus.ui.transcript

import dev.houwert.argus.ui.syntax.CodeHighlighting
import dev.houwert.argus.ui.syntax.SyntaxHighlighter
import dev.houwert.argus.ui.syntax.SyntaxLanguage
import dev.houwert.argus.ui.syntax.SyntaxLimits
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.transcript.FileLinks
import dev.houwert.argus.kit.util.MarkdownBlock
import dev.houwert.argus.ui.theme.ArgusColors
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/**
 * Markdown rendered as Compose text. Blocks come from the kit's [MarkdownBlock]; inline
 * formatting from [InlineMarkdown]. [mentions] is what a person typed: only `@paths` link as files.
 */
@Composable
fun MarkdownView(text: String, modifier: Modifier = Modifier, baseSize: Int = 15, mentions: Boolean = false) {
  val theme = ArgusTheme.colors
  val blocks = remember(text) { MarkdownBlock.parse(text) }
  val inline = rememberInline(mentions)
  Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
    for (block in blocks) {
      when (block) {
        is MarkdownBlock.Heading ->
          Text(
            inline(block.text), Modifier.padding(top = 2.dp), color = theme.text,
            style = argusFont(headingSize(block.level), FontWeight.Bold),
          )
        is MarkdownBlock.Paragraph -> Text(inline(block.text), color = theme.text, style = argusFont(baseSize))
        is MarkdownBlock.Code -> CodeBlockView(block.body, language = block.language)
        is MarkdownBlock.Quote ->
          Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(theme.borderStrong))
            Text(inline(block.text), color = theme.text, style = argusFont(baseSize))
          }
        is MarkdownBlock.ListBlock ->
          Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            block.items.forEachIndexed { index, item ->
              Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(if (block.ordered) "${index + 1}." else "•", color = theme.textMuted, style = argusFont(baseSize))
                Text(inline(item), color = theme.text, style = argusFont(baseSize))
              }
            }
          }
        is MarkdownBlock.Table -> MarkdownTable(block.columns, block.rows, inline)
        MarkdownBlock.Rule -> Box(Modifier.fillMaxWidth().height(1.dp).background(theme.border))
      }
    }
  }
}

private fun headingSize(level: Int) = when (level) {
  1 -> 19
  2 -> 17
  else -> 15
}

/** Inline markdown to styled text with tappable links, for this theme and link handler. */
@Composable
internal fun rememberInline(mentions: Boolean): (String) -> AnnotatedString {
  val theme = ArgusTheme.colors
  val openFile = LocalOpenFileLink.current ?: LocalTranscript.current?.openFileLink
  val uri = LocalUriHandler.current
  return remember(theme, openFile, uri, mentions) {
    val cache = HashMap<String, AnnotatedString>()
    val render: (String) -> AnnotatedString = { source -> cache.getOrPut(source) { inlineAnnotated(source, theme, openFile, uri, mentions) } }
    render
  }
}

internal fun inlineAnnotated(
  source: String,
  theme: ArgusColors,
  openFile: ((FileLinks.FileRef) -> Unit)?,
  uri: UriHandler,
  mentions: Boolean,
): AnnotatedString {
  val parsed = InlineMarkdown.linkified(InlineMarkdown.parse(source), files = openFile != null, mentions = mentions)
  // Underlined too, since Muted's accent is the text colour.
  val linkStyle = TextLinkStyles(SpanStyle(color = theme.accent, textDecoration = TextDecoration.Underline))
  return buildAnnotatedString {
    append(parsed.text)
    for (span in parsed.spans) {
      when (val style = span.style) {
        InlineMarkdown.Style.Bold -> addStyle(SpanStyle(fontWeight = FontWeight.Bold), span.start, span.end)
        InlineMarkdown.Style.Italic -> addStyle(SpanStyle(fontStyle = FontStyle.Italic), span.start, span.end)
        InlineMarkdown.Style.Strike -> addStyle(SpanStyle(textDecoration = TextDecoration.LineThrough), span.start, span.end)
        InlineMarkdown.Style.Code ->
          addStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = theme.bgTertiary), span.start, span.end)
        is InlineMarkdown.Style.Link -> {
          val ref = FileLinks.fileRef(style.url)
          val link =
            if (ref != null && openFile != null) {
              LinkAnnotation.Clickable(style.url, linkStyle) { openFile(ref) }
            } else {
              LinkAnnotation.Clickable(style.url, linkStyle) { runCatching { uri.openUri(style.url) } }
            }
          addLink(link, span.start, span.end)
        }
      }
    }
  }
}

/**
 * A fenced code block, coloured when the info string names a grammar; plain monospaced text until
 * (or unless) one does. Scrolls sideways rather than wrapping.
 */
@Composable
fun CodeBlockView(code: String, modifier: Modifier = Modifier, language: String? = null) {
  val theme = ArgusTheme.colors
  val palette = ArgusTheme.syntax
  val highlighted = remember(code, language, palette) { highlightedCode(code, language, palette) }
  Column(
    modifier.fillMaxWidth().clip(RoundedCornerShape(ArgusMetrics.radiusSmall)).background(theme.bgTertiary),
  ) {
    if (!language.isNullOrEmpty()) {
      Text(
        language, Modifier.padding(horizontal = 8.dp, vertical = 4.dp), color = theme.textMuted,
        style = argusFont(10, FontWeight.SemiBold),
      )
    }
    Box(Modifier.horizontalScroll(rememberScrollState())) {
      Text(
        highlighted ?: AnnotatedString(code), Modifier.padding(8.dp), color = theme.textSecondary,
        style = argusFont(12, mono = true), softWrap = false,
      )
    }
  }
}

/** The one place a code block gets its colours: by its fence's language; null renders it plain. */
internal fun highlightedCode(code: String, language: String?, palette: dev.houwert.argus.ui.theme.SyntaxPalette): AnnotatedString? {
  val syntax = language?.takeIf { it.isNotBlank() }?.let { SyntaxLanguage.fromName(it) } ?: return null
  if (SyntaxLimits.highlightingDisabledReason(code.length, code) != null) return null
  return CodeHighlighting.annotated(code, SyntaxHighlighter.highlight(code, syntax), palette)
}

/**
 * A markdown table. Scrolls sideways rather than wrapping cells into slivers; each column is as
 * wide as its widest cell, capped so a long cell wraps.
 */
@Composable
private fun MarkdownTable(columns: List<String>, rows: List<List<String>>, inline: (String) -> AnnotatedString) {
  val theme = ArgusTheme.colors
  val all = listOf(columns) + rows
  val count = all.maxOf { it.size }
  Box(
    Modifier.fillMaxWidth()
      .clip(RoundedCornerShape(ArgusMetrics.radiusSmall))
      .background(theme.bgTertiary.copy(alpha = theme.bgTertiary.alpha * 0.5f))
      .horizontalScroll(rememberScrollState())
      .padding(vertical = 4.dp),
  ) {
    TableGrid(count, all.size, theme.borderSubtle) {
      all.forEachIndexed { rowIndex, cells ->
        for (column in 0 until count) {
          Text(
            inline(cells.getOrElse(column) { "" }),
            Modifier.widthIn(max = 240.dp).padding(horizontal = 8.dp, vertical = 5.dp),
            color = theme.text,
            style = argusFont(13, if (rowIndex == 0) FontWeight.SemiBold else FontWeight.Normal),
          )
        }
      }
    }
  }
}

/** Cells row-major, then a divider per row break; each column takes its widest cell, each row its tallest. */
@Composable
private fun TableGrid(columns: Int, rows: Int, divider: androidx.compose.ui.graphics.Color, content: @Composable () -> Unit) {
  Layout({
    content()
    repeat((rows - 1).coerceAtLeast(0)) { Box(Modifier.background(divider)) }
  }) { measurables, _ ->
    val cells = columns * rows
    val placeables = measurables.take(cells).map { it.measure(Constraints()) }
    val widths = IntArray(columns)
    val heights = IntArray(rows)
    placeables.forEachIndexed { index, p ->
      widths[index % columns] = maxOf(widths[index % columns], p.width)
      heights[index / columns] = maxOf(heights[index / columns], p.height)
    }
    val line = 1.dp.roundToPx()
    val total = widths.sum()
    val lines = measurables.drop(cells).map { it.measure(Constraints.fixed(total, line)) }
    layout(total, heights.sum() + line * lines.size) {
      var y = 0
      for (row in 0 until rows) {
        var x = 0
        for (column in 0 until columns) {
          placeables.getOrNull(row * columns + column)?.placeRelative(x, y)
          x += widths[column]
        }
        y += heights[row]
        lines.getOrNull(row)?.let { it.placeRelative(0, y); y += line }
      }
    }
  }
}
