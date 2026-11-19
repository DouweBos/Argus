package dev.houwert.argus.ui.syntax

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import dev.houwert.argus.ui.theme.SyntaxPalette

/** Turns code and its runs into coloured [AnnotatedString]s, for `CodeView` and chat code blocks. */
object CodeHighlighting {
  /** Each line's UTF-16 range, without its newline. */
  fun lineRanges(text: String): List<IntRange> {
    val ranges = ArrayList<IntRange>()
    var start = 0
    while (true) {
      val newline = text.indexOf('\n', start)
      if (newline < 0) {
        ranges += start until text.length
        return ranges
      }
      ranges += start until newline
      start = newline + 1
    }
  }

  /** The whole of [code] as one coloured string. */
  fun annotated(code: String, runs: List<SyntaxRun>, palette: SyntaxPalette): AnnotatedString =
    AnnotatedString.Builder(code).apply {
      for (run in runs) addStyle(style(run.capture, palette), run.start, run.end)
    }.toAnnotatedString()

  /** One coloured string per line, a run crossing lines split between them. */
  fun annotatedLines(code: String, runs: List<SyntaxRun>, palette: SyntaxPalette): List<AnnotatedString> {
    val sorted = runs.sortedBy { it.start }
    var cursor = 0
    return lineRanges(code).map { range ->
      val lineEnd = range.last + 1
      val builder = AnnotatedString.Builder(code.substring(range.first, lineEnd))
      while (cursor < sorted.size && sorted[cursor].end <= range.first) cursor++
      var i = cursor
      while (i < sorted.size && sorted[i].start < lineEnd) {
        val run = sorted[i]
        val start = maxOf(run.start, range.first) - range.first
        val end = minOf(run.end, lineEnd) - range.first
        if (end > start) builder.addStyle(style(run.capture, palette), start, end)
        i++
      }
      builder.toAnnotatedString()
    }
  }

  fun color(capture: SyntaxCapture, palette: SyntaxPalette): Color = when (capture) {
    SyntaxCapture.Keyword -> palette.keyword
    SyntaxCapture.String -> palette.string
    SyntaxCapture.Comment -> palette.comment
    SyntaxCapture.Type -> palette.type
    SyntaxCapture.Function -> palette.function
    SyntaxCapture.Number -> palette.number
    SyntaxCapture.Constant -> palette.constant
    SyntaxCapture.Variable -> palette.variable
    SyntaxCapture.Property -> palette.property
    SyntaxCapture.Operator -> palette.operator
    SyntaxCapture.Punctuation -> palette.punctuation
    SyntaxCapture.Tag -> palette.tag
    SyntaxCapture.Attribute -> palette.attribute
    SyntaxCapture.Escape -> palette.escape
    SyntaxCapture.Regex -> palette.regex
    SyntaxCapture.Heading -> palette.heading
    SyntaxCapture.Link -> palette.link
    SyntaxCapture.Emphasis, SyntaxCapture.Strong -> palette.variable
    SyntaxCapture.Code -> palette.string
  }

  private fun style(capture: SyntaxCapture, palette: SyntaxPalette) = SpanStyle(
    color = color(capture, palette),
    fontStyle = if (capture == SyntaxCapture.Emphasis) FontStyle.Italic else null,
    fontWeight = if (capture == SyntaxCapture.Strong || capture == SyntaxCapture.Heading) FontWeight.SemiBold else null,
  )
}
