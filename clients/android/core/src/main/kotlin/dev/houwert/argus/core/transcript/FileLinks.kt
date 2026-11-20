package dev.houwert.argus.core.transcript

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.file.Paths
import java.util.regex.Matcher
import java.util.regex.Pattern

/** A UTF-16 span of a string (Swift's `NSRange`), which is what a text view highlights and hit-tests in. */
data class TextRange(val location: Int, val length: Int) {
  val end: Int get() = location + length
}

/**
 * File paths and URLs in transcript text, ported from `app/lib/filePathLink.ts` so every client
 * links the same tokens. Ranges are UTF-16 offsets.
 */
object FileLinks {
  data class FileRef(val path: String, val line: Int? = null, val column: Int? = null)

  sealed interface Kind {
    data class File(val ref: FileRef) : Kind
    data class Url(val url: String) : Kind
  }

  data class Match(val range: TextRange, val kind: Kind)

  sealed interface Segment {
    data class Text(val text: String) : Segment
    data class Link(val label: String, val ref: FileRef) : Segment
    data class Url(val url: String) : Segment
  }

  /** Kept tight so prose like "foo.bar" doesn't light up. */
  internal val extensions = listOf(
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "css", "scss", "html", "md", "mdx",
    "yml", "yaml", "toml", "swift", "m", "mm", "h", "c", "cpp", "rs", "go", "py", "rb",
    "sh", "zsh", "bash", "sql", "xml", "plist", "lock", "env", "gitignore", "dockerfile",
    "pbxproj",
  )

  // `\w` spelled out as ASCII, as JavaScript's is without the `u` flag.
  private const val WORD = "A-Za-z0-9_"

  private val filePathPattern: Pattern = run {
    val ext = extensions.joinToString("|")
    val core = "(?:/|\\.\\.?/|~/)?[$WORD.\\-/@]*[$WORD\\-]\\.(?:$ext)"
    Pattern.compile("(?<![$WORD/@-])($core)(?::(\\d+))?(?::(\\d+))?(?![$WORD])", Pattern.CASE_INSENSITIVE)
  }

  private val urlPattern: Pattern = unicode("https?://[^\\s<>\"']+", Pattern.CASE_INSENSITIVE)
  private val mentionPattern: Pattern = unicode("(^|\\s)@((?:\\\\\\s|\\S)+)")

  /** Android's ICU regex is Unicode-aware already and rejects the flag the JVM needs for it. */
  private fun unicode(regex: String, flags: Int = 0): Pattern =
    runCatching { Pattern.compile(regex, flags or Pattern.UNICODE_CHARACTER_CLASS) }.getOrElse { Pattern.compile(regex, flags) }
  private val fileRefRegex = Regex("""^(.*?)(?::(\d+))?(?::(\d+))?$""")
  private val shellEscape = Regex("""\\(\s)""")

  private val trailing = setOf('.', ',', ';', ':', '!', '?', ')', ']', '}', '>', '\'', '"')

  // Detection

  /** Every URL and file path in [text], in order, never overlapping; paths only between URLs, so a URL stays one link. */
  fun matches(text: String): List<Match> {
    val result = mutableListOf<Match>()
    var cursor = 0
    for (url in urlRanges(text)) {
      if (url.range.location > cursor) result += filePaths(text, cursor, url.range.location)
      result.add(url)
      cursor = url.range.end
    }
    if (cursor < text.length) result += filePaths(text, cursor, text.length)
    return result
  }

  /** `@mentions` the user typed, which need no extension, plus URLs. */
  fun mentionMatches(text: String): List<Match> {
    val markers = mutableListOf<Match>()
    val matcher = mentionPattern.matcher(text)
    while (matcher.find()) {
      val leading = matcher.end(1) - matcher.start(1)
      val token = trimTrailing(matcher.group(2))
      if (token.isEmpty()) continue
      val start = matcher.start() + leading
      val parsed = parseFileRef(token)
      val ref = parsed.copy(path = shellEscape.replace(parsed.path) { it.groupValues[1] })
      markers.add(Match(TextRange(start, 1 + token.length), Kind.File(ref)))
    }
    markers += urlRanges(text)
    markers.sortBy { it.range.location }

    val result = mutableListOf<Match>()
    var cursor = 0
    for (marker in markers) {
      if (marker.range.location < cursor) continue
      result.add(marker)
      cursor = marker.range.end
    }
    return result
  }

  /** `path[:line[:col]]` to its parts. */
  fun parseFileRef(raw: String): FileRef {
    val match = fileRefRegex.matchEntire(raw) ?: return FileRef(raw)
    return FileRef(
      match.groupValues[1],
      match.groups[2]?.value?.toIntOrNull(),
      match.groups[3]?.value?.toIntOrNull(),
    )
  }

  /** [text] cut into plain runs and links, for renderers that build text piecewise. */
  fun split(text: String): List<Segment> = segments(text, matches(text))

  fun splitMentions(text: String): List<Segment> = segments(text, mentionMatches(text))

  // Resolution

  /** An absolute path: `~/` against [home], relative paths against the worktree; null with nothing to resolve against. */
  fun resolve(path: String, worktree: String?, home: String? = null): String? {
    if (path.startsWith("/")) return normalize(path)
    if (path.startsWith("~/")) return home?.let { normalize(Paths.get(it, path.drop(2)).toString()) }
    if (worktree.isNullOrEmpty()) return null
    return normalize(Paths.get(worktree, path).toString())
  }

  private fun normalize(path: String): String = Paths.get(path).normalize().toString()

  // Link URLs

  /** File links travel through rendered text as URLs on a private scheme, so text hit-tests them like any link. */
  const val SCHEME = "argus-file"

  // Charset-name overloads: the Charset ones need API 33.
  private fun encode(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

  fun url(ref: FileRef): String {
    val query = buildList {
      add("path=${encode(ref.path)}")
      ref.line?.let { add("line=$it") }
      ref.column?.let { add("col=$it") }
    }
    return "$SCHEME://open?${query.joinToString("&")}"
  }

  fun fileRef(url: String): FileRef? {
    val uri = runCatching { URI(url) }.getOrNull() ?: return null
    if (uri.scheme != SCHEME) return null
    val items = uri.rawQuery.orEmpty().split('&').filter { it.isNotEmpty() }.associate {
      val name = it.substringBefore('=')
      name to URLDecoder.decode(it.substringAfter('=', ""), "UTF-8")
    }
    val path = items["path"] ?: return null
    return FileRef(path, items["line"]?.toIntOrNull(), items["col"]?.toIntOrNull())
  }

  /** What a match links to: a file on the private scheme, a URL as written. */
  fun url(kind: Kind): String = when (kind) {
    is Kind.File -> url(kind.ref)
    is Kind.Url -> kind.url
  }

  // Internals

  private fun filePaths(text: String, start: Int, end: Int): List<Match> {
    val matcher: Matcher = filePathPattern.matcher(text).region(start, end)
    val out = mutableListOf<Match>()
    while (matcher.find()) {
      val ref = FileRef(matcher.group(1), matcher.group(2)?.toIntOrNull(), matcher.group(3)?.toIntOrNull())
      out.add(Match(TextRange(matcher.start(), matcher.end() - matcher.start()), Kind.File(ref)))
    }
    return out
  }

  private fun urlRanges(text: String): List<Match> {
    val matcher = urlPattern.matcher(text)
    val out = mutableListOf<Match>()
    while (matcher.find()) {
      val url = trimTrailing(matcher.group())
      if (url.isEmpty()) continue
      out.add(Match(TextRange(matcher.start(), url.length), Kind.Url(url)))
    }
    return out
  }

  /** Drops sentence punctuation, but keeps a closer whose opener is in the token: `dir (3)` keeps its `)`. */
  internal fun trimTrailing(token: String): String {
    val pairs = mapOf(')' to '(', ']' to '[', '}' to '{')
    var out = token
    while (out.isNotEmpty() && out.last() in trailing) {
      val last = out.last()
      val opener = pairs[last]
      if (opener != null) {
        val inner = out.dropLast(1)
        if (inner.count { it == opener } > inner.count { it == last }) break
      }
      out = out.dropLast(1)
    }
    return out
  }

  private fun segments(text: String, matches: List<Match>): List<Segment> {
    val segments = mutableListOf<Segment>()
    var cursor = 0
    for (match in matches) {
      if (match.range.location > cursor) segments.add(Segment.Text(text.substring(cursor, match.range.location)))
      val label = text.substring(match.range.location, match.range.end)
      segments.add(
        when (val kind = match.kind) {
          is Kind.File -> Segment.Link(label, kind.ref)
          is Kind.Url -> Segment.Url(kind.url)
        },
      )
      cursor = match.range.end
    }
    if (cursor < text.length) segments.add(Segment.Text(text.substring(cursor)))
    return segments
  }
}
