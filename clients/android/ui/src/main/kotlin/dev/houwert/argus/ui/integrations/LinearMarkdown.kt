package dev.houwert.argus.ui.integrations

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Row
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
import dev.houwert.argus.kit.util.LinearMediaLink
import dev.houwert.argus.kit.util.MarkdownBlock
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/**
 * An issue's description or comment as Linear writes it: headings, paragraphs, lists, quotes and
 * code, with links tappable through [onLink] and Linear uploads on a line of their own as embeds.
 */
@Composable
fun LinearMarkdown(text: String, onLink: (String) -> Unit, modifier: Modifier = Modifier, baseSize: Int = 15) {
  val theme = ArgusTheme.colors
  val blocks = remember(text) { MarkdownBlock.parse(text) }
  val linkColor = theme.accent
  val codeBackground = theme.bgTertiary
  fun inline(source: String) = LinearInline.annotate(source, linkColor, codeBackground, onLink)
  SelectionContainer(modifier) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
      for (block in blocks) {
        when (block) {
          is MarkdownBlock.Heading ->
            Text(inline(block.text), color = theme.text, style = argusFont(baseSize + maxOf(0, 5 - block.level) * 2, FontWeight.SemiBold))
          is MarkdownBlock.Paragraph ->
            for (segment in LinearMediaLink.segments(block.text)) {
              when (segment) {
                is LinearMediaLink.Segment.Text -> Text(inline(segment.text), color = theme.text, style = argusFont(baseSize))
                is LinearMediaLink.Segment.Media -> LinearMediaEmbed(segment.media, onOpen = { onLink(segment.media.url) })
              }
            }
          is MarkdownBlock.ListBlock ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
              block.items.forEachIndexed { index, item ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                  Text(if (block.ordered) "${index + 1}." else "•", color = theme.textMuted, style = argusFont(baseSize))
                  Text(inline(item), color = theme.text, style = argusFont(baseSize))
                }
              }
            }
          is MarkdownBlock.Quote ->
            Row(Modifier.height(IntrinsicSize.Min)) {
              Box(Modifier.width(3.dp).fillMaxHeight().background(theme.border))
              Text(inline(block.text), Modifier.padding(start = 10.dp), color = theme.textSecondary, style = argusFont(baseSize))
            }
          is MarkdownBlock.Code ->
            Box(
              Modifier.fillMaxWidth()
                .background(theme.bgTertiary, RoundedCornerShape(6.dp))
                .horizontalScroll(rememberScrollState())
                .padding(10.dp)
            ) {
              Text(block.body, color = theme.text, style = argusFont(baseSize - 2, mono = true))
            }
          is MarkdownBlock.Table ->
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
              Text(block.columns.joinToString("  |  "), color = theme.text, style = argusFont(baseSize - 2, FontWeight.SemiBold))
              for (row in block.rows) Text(inline(row.joinToString("  |  ")), color = theme.textSecondary, style = argusFont(baseSize - 2))
            }
          MarkdownBlock.Rule -> Box(Modifier.fillMaxWidth().height(1.dp).background(theme.border))
        }
      }
    }
  }
}

/** Inline markdown to styled text: links, bare URLs, bold, italic and code. */
object LinearInline {
  private val pattern = Regex("""\[([^\]]+)]\(([^)\s]+)(?:\s+"[^"]*")?\)|(https?://[^\s)]+)|\*\*([^*]+)\*\*|`([^`]+)`|(?<![\w*])[*_]([^*_]+)[*_](?![\w*])""")

  fun annotate(source: String, linkColor: Color, codeBackground: Color, onLink: (String) -> Unit): AnnotatedString = buildAnnotatedString {
    var at = 0
    for (match in pattern.findAll(source)) {
      append(source.substring(at, match.range.first))
      val (label, target, bare, bold, code, italic) = match.destructured
      when {
        target.isNotEmpty() -> link(label, target, linkColor, onLink)
        bare.isNotEmpty() -> link(bare, bare, linkColor, onLink)
        bold.isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(bold) }
        code.isNotEmpty() -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBackground)) { append(code) }
        italic.isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(italic) }
      }
      at = match.range.last + 1
    }
    append(source.substring(at))
  }

  private fun AnnotatedString.Builder.link(text: String, url: String, color: Color, onLink: (String) -> Unit) {
    withLink(LinkAnnotation.Clickable(url, TextLinkStyles(SpanStyle(color = color))) { onLink(url) }) { append(text) }
  }
}
