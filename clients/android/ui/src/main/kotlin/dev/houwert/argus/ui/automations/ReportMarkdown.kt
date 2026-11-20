package dev.houwert.argus.ui.automations

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.util.MarkdownBlock
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/**
 * A report's or a memory's markdown: blocks from kit's parser, inline emphasis, code spans and
 * links styled here. Links open in the browser through the platform's URI handler.
 */
@Composable
fun ReportMarkdown(text: String, modifier: Modifier = Modifier, baseSize: Int = 15) {
  val theme = ArgusTheme.colors
  val blocks = remember(text) { MarkdownBlock.parse(text) }
  SelectionContainer(modifier) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      for (block in blocks) {
        when (block) {
          is MarkdownBlock.Heading ->
            Text(inline(block.text, theme.accent, theme.bgTertiary), color = theme.text, style = argusFont(headingSize(block.level, baseSize), FontWeight.Bold))
          is MarkdownBlock.Paragraph -> Text(inline(block.text, theme.accent, theme.bgTertiary), color = theme.text, style = argusFont(baseSize))
          is MarkdownBlock.Code ->
            Text(
              block.body,
              Modifier.fillMaxWidth().background(theme.bgTertiary, RoundedCornerShape(ArgusMetrics.radiusSmall))
                .horizontalScroll(rememberScrollState()).padding(10.dp),
              color = theme.text, style = argusFont(13, mono = true), softWrap = false,
            )
          is MarkdownBlock.Quote ->
            Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
              Box(Modifier.width(3.dp).fillMaxHeight().background(theme.borderStrong))
              Text(inline(block.text, theme.accent, theme.bgTertiary), color = theme.textSecondary, style = argusFont(baseSize))
            }
          is MarkdownBlock.ListBlock ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
              block.items.forEachIndexed { i, item ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                  Text(if (block.ordered) "${i + 1}." else "•", color = theme.textMuted, style = argusFont(baseSize))
                  Text(inline(item, theme.accent, theme.bgTertiary), color = theme.text, style = argusFont(baseSize))
                }
              }
            }
          is MarkdownBlock.Table -> MarkdownTable(block.columns, block.rows)
          MarkdownBlock.Rule -> Box(Modifier.fillMaxWidth().height(1.dp).background(theme.border))
        }
      }
    }
  }
}

@Composable
private fun MarkdownTable(columns: List<String>, rows: List<List<String>>) {
  val theme = ArgusTheme.colors
  Column(
    Modifier.fillMaxWidth().background(theme.bgTertiary, RoundedCornerShape(ArgusMetrics.radiusSmall))
      .horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 4.dp),
  ) {
    Row { for (c in columns) Text(c, Modifier.width(130.dp).padding(vertical = 6.dp), color = theme.textMuted, style = argusFont(11, FontWeight.Bold)) }
    for (row in rows) {
      Row { for (cell in row) Text(cell, Modifier.width(130.dp).padding(vertical = 5.dp), color = theme.text, style = argusFont(13)) }
    }
  }
}

private fun headingSize(level: Int, base: Int): Int = when (level) {
  1 -> base + 5
  2 -> base + 3
  3 -> base + 1
  else -> base
}

private val inlineToken = Regex("""\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\[([^\]]+)]\(([^)\s]+)\)|(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\w)|(?<![_\w])_(?!\s)(.+?)(?<!\s)_(?!\w)""")

/** Bold, italic, code spans and links; anything fancier shows as typed. */
internal fun inline(text: String, link: Color, codeBackground: Color): AnnotatedString = buildAnnotatedString {
  var last = 0
  for (match in inlineToken.findAll(text)) {
    append(text.substring(last, match.range.first))
    val g = match.groupValues
    when {
      g[1].isNotEmpty() || g[2].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(inline(g[1].ifEmpty { g[2] }, link, codeBackground)) }
      g[3].isNotEmpty() -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBackground)) { append(g[3]) }
      g[4].isNotEmpty() -> withLink(LinkAnnotation.Url(g[5], TextLinkStyles(SpanStyle(color = link)))) { append(g[4]) }
      g[6].isNotEmpty() || g[7].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(g[6].ifEmpty { g[7] }) }
    }
    last = match.range.last + 1
  }
  append(text.substring(last))
}
