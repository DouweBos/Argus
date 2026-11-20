package dev.houwert.argus.ui.transcript

import dev.houwert.argus.core.transcript.FileLinks

/**
 * Inline markdown (emphasis, code spans, links, autolinks, strikethrough) as plain text plus
 * styled ranges: what `AttributedString(markdown:)` with `.inlineOnlyPreservingWhitespace` gives
 * the Swift views. Pure, so it's tested without Compose.
 */
object InlineMarkdown {
  sealed interface Style {
    data object Bold : Style
    data object Italic : Style
    data object Code : Style
    data object Strike : Style
    data class Link(val url: String) : Style
  }

  data class Span(val start: Int, val end: Int, val style: Style)

  data class Parsed(val text: String, val spans: List<Span>) {
    val links: List<String> get() = spans.mapNotNull { (it.style as? Style.Link)?.url }
  }

  private const val PUNCTUATION = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"

  fun parse(source: String): Parsed {
    val out = StringBuilder()
    val spans = mutableListOf<Span>()
    Parser(source, out, spans).run(0, source.length)
    return Parsed(out.toString(), spans.sortedBy { it.start })
  }

  /**
   * Bare URLs, and file paths when [files], become links except where markdown already made one.
   * [mentions] is for what a person typed: only `@paths` count as files there.
   */
  fun linkified(parsed: Parsed, files: Boolean, mentions: Boolean = false): Parsed {
    val matches = if (mentions) FileLinks.mentionMatches(parsed.text) else FileLinks.matches(parsed.text)
    if (matches.isEmpty()) return parsed
    val links = parsed.spans.filter { it.style is Style.Link }
    val added = matches.mapNotNull { match ->
      if (match.kind is FileLinks.Kind.File && !files) return@mapNotNull null
      val start = match.range.location
      val end = match.range.end
      if (links.any { it.start < end && start < it.end }) return@mapNotNull null
      Span(start, end, Style.Link(FileLinks.url(match.kind)))
    }
    return if (added.isEmpty()) parsed else parsed.copy(spans = (parsed.spans + added).sortedBy { it.start })
  }

  private class Parser(val src: String, val out: StringBuilder, val spans: MutableList<Span>) {
    fun run(from: Int, to: Int) {
      var i = from
      while (i < to) {
        val c = src[i]
        i = when {
          c == '\\' && i + 1 < to && src[i + 1] in PUNCTUATION -> { out.append(src[i + 1]); i + 2 }
          c == '`' -> codeSpan(i, to) ?: literal(i, runLength(i, to, '`'))
          c == '[' -> link(i, to) ?: literal(i, 1)
          c == '<' -> autolink(i, to) ?: literal(i, 1)
          c == '~' && src.startsWith("~~", i) -> emphasis(i, to, "~~", Style.Strike) ?: literal(i, 2)
          c == '*' || c == '_' -> {
            val run = runLength(i, to, c)
            if (run >= 2) emphasis(i, to, "$c$c", Style.Bold) ?: emphasis(i, to, "$c", Style.Italic) ?: literal(i, run)
            else emphasis(i, to, "$c", Style.Italic) ?: literal(i, 1)
          }
          else -> literal(i, 1)
        }
      }
    }

    private fun literal(at: Int, count: Int): Int {
      out.append(src, at, at + count)
      return at + count
    }

    private fun runLength(at: Int, to: Int, c: Char): Int {
      var n = 0
      while (at + n < to && src[at + n] == c) n += 1
      return n
    }

    private fun codeSpan(at: Int, to: Int): Int? {
      val ticks = runLength(at, to, '`')
      var search = at + ticks
      while (search < to) {
        val close = src.indexOf('`', search)
        if (close < 0 || close >= to) return null
        val run = runLength(close, to, '`')
        if (run == ticks) {
          var body = src.substring(at + ticks, close).replace('\n', ' ')
          if (body.length >= 2 && body.startsWith(' ') && body.endsWith(' ') && body.isNotBlank()) body = body.substring(1, body.length - 1)
          val start = out.length
          out.append(body)
          spans.add(Span(start, out.length, Style.Code))
          return close + run
        }
        search = close + run
      }
      return null
    }

    private fun link(at: Int, to: Int): Int? {
      var depth = 0
      var i = at
      var close = -1
      while (i < to) {
        when (src[i]) {
          '\\' -> i += 1
          '`' -> { codeEnd(i, to)?.let { i = it - 1 } }
          '[' -> depth += 1
          ']' -> { depth -= 1; if (depth == 0) { close = i; break } }
        }
        i += 1
      }
      if (close < 0 || close + 1 >= to || src[close + 1] != '(') return null
      val end = src.indexOf(')', close + 2).takeIf { it in 0 until to } ?: return null
      val target = src.substring(close + 2, end).trim()
      val url = target.substringBefore(' ').removePrefix("<").removeSuffix(">")
      if (url.isEmpty()) return null
      val start = out.length
      run(at + 1, close)
      spans.add(Span(start, out.length, Style.Link(url)))
      return end + 1
    }

    private fun codeEnd(at: Int, to: Int): Int? {
      val ticks = runLength(at, to, '`')
      var search = at + ticks
      while (search < to) {
        val close = src.indexOf('`', search).takeIf { it in 0 until to } ?: return null
        val run = runLength(close, to, '`')
        if (run == ticks) return close + run
        search = close + run
      }
      return null
    }

    private fun autolink(at: Int, to: Int): Int? {
      val end = src.indexOf('>', at + 1).takeIf { it in 0 until to } ?: return null
      val inner = src.substring(at + 1, end)
      if (!(inner.startsWith("http://") || inner.startsWith("https://") || inner.startsWith("mailto:")) || inner.any { it.isWhitespace() }) return null
      val start = out.length
      out.append(inner)
      spans.add(Span(start, out.length, Style.Link(inner)))
      return end + 1
    }

    /** A `delim`-wrapped run: the opener can't be followed by a space, the closer can't follow one; `_` needs word edges. */
    private fun emphasis(at: Int, to: Int, delim: String, style: Style): Int? {
      val open = at + delim.length
      if (open >= to || src[open].isWhitespace()) return null
      val underscore = delim[0] == '_'
      if (underscore && at > 0 && src[at - 1].isLetterOrDigit()) return null
      var i = open
      while (i < to) {
        val c = src[i]
        if (c == '\\') { i += 2; continue }
        if (c == '`') { i = codeEnd(i, to) ?: (i + 1); continue }
        if (src.startsWith(delim, i) && !src[i - 1].isWhitespace() && i > open) {
          val after = i + delim.length
          // `**` inside an italic run is its own delimiter, not this one's closer.
          val longer = after < to && src[after] == delim[0]
          val wordAfter = underscore && after < to && src[after].isLetterOrDigit()
          if (!longer && !wordAfter) {
            val start = out.length
            run(open, i)
            spans.add(Span(start, out.length, style))
            return after
          }
          i = after + (if (longer) runLength(after, to, delim[0]) else 0)
          continue
        }
        i += 1
      }
      return null
    }
  }
}
