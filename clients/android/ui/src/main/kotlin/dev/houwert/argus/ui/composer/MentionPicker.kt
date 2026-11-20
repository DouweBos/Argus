package dev.houwert.argus.ui.composer

/**
 * The `@`-mention picker, caret-aware: search mode lists matching directories then files, browse
 * mode lists one directory from the host. Offsets are UTF-16, which is what a Kotlin String indexes.
 */
object MentionPicker {
  const val MAX_RESULTS = 12
  internal const val MAX_DIRECTORIES = 6

  /** The `@token` the caret sits in. `start` is the offset of the `@`. */
  data class Context(val query: String, val start: Int)

  data class Item(
    val display: String,
    /** The parent directory in search mode. */
    val hint: String? = null,
    val isDirectory: Boolean,
    /** "Link this directory": the browsed directory itself. */
    val isLinkAction: Boolean = false,
  ) {
    val id: String get() = "$isLinkAction-${hint.orEmpty()}/$display"
  }

  data class Edit(val text: String, val caret: Int)

  fun detect(text: String, caret: Int): Context? {
    val end = caret.coerceIn(0, text.length)
    val at = text.lastIndexOf('@', end - 1).takeIf { end > 0 } ?: return null
    if (at < 0) return null
    if (at > 0 && !isWhitespace(text[at - 1])) return null
    val query = text.substring(at + 1, end)
    if (query.any { it.isWhitespace() }) return null
    return Context(query, at)
  }

  /** A query naming a path browses the tree; anything else searches the flat file list. */
  fun isBrowsing(query: String) = '/' in query || query.startsWith("~") || query.startsWith(".")

  /** `src/comp` → (`src/`, `comp`); `~Work` → (`~/`, `work`). */
  fun splitBrowse(query: String): Pair<String, String> {
    val slash = query.lastIndexOf('/')
    if (slash < 0) {
      if (query == "~" || query == ".") return query to ""
      if (query.startsWith("~")) return "~/" to query.drop(1).lowercase()
      return "./" to query.drop(1).lowercase()
    }
    return query.substring(0, slash + 1) to query.substring(slash + 1).lowercase()
  }

  /** Every ancestor directory of the listed files, sorted. */
  fun directories(files: List<String>): List<String> {
    val dirs = HashSet<String>()
    for (file in files) {
      var path = file
      while (true) {
        val slash = path.lastIndexOf('/')
        if (slash < 0) break
        path = path.substring(0, slash)
        if (!dirs.add(path)) break
      }
    }
    return dirs.sorted()
  }

  fun search(files: List<String>, directories: List<String>, query: String): List<Item> {
    val needle = query.lowercase()
    fun ranked(paths: List<String>) = paths.filter { needle.isEmpty() || needle in it.lowercase() }
      .withIndex()
      .sortedWith(compareByDescending<IndexedValue<String>> { score(basename(it.value), needle) }.thenBy { it.index })
      .map { it.value }
    val dirs = ranked(directories).take(MAX_DIRECTORIES).map { Item(basename(it), dirname(it), isDirectory = true) }
    val found = ranked(files).take(MAX_RESULTS - dirs.size).map { Item(basename(it), dirname(it), isDirectory = false) }
    return dirs + found
  }

  data class Entry(val name: String, val isDirectory: Boolean)

  fun browse(directory: String, entries: List<Entry>, filter: String): List<Item> {
    val link = Item(trimSlashes(directory), isDirectory = true, isLinkAction = true)
    val items = entries.map { Item(it.name, isDirectory = it.isDirectory) }
    if (filter.isEmpty()) return listOf(link) + items
    val matched = items.filter { filter in it.display.lowercase() }
      .withIndex()
      .sortedWith(compareByDescending<IndexedValue<Item>> { score(it.value.display, filter) }.thenBy { it.index })
      .map { it.value }
    return listOf(link) + matched
  }

  /** The full path an item stands for. */
  fun path(item: Item, context: Context): String {
    if (isBrowsing(context.query)) {
      val directory = splitBrowse(context.query).first
      return if (item.isLinkAction) trimSlashes(directory) else directory + item.display
    }
    val hint = item.hint
    return if (hint.isNullOrEmpty()) item.display else "$hint/${item.display}"
  }

  /** A directory drills in (`@path/`, picker stays open); anything else inserts `@path ` and closes it. */
  fun apply(item: Item, context: Context, text: String): Edit {
    val tokenEnd = minOf(context.start + 1 + context.query.length, text.length)
    val before = text.substring(0, context.start)
    val after = text.substring(tokenEnd)
    val full = path(item, context)
    val insertion = if (item.isDirectory && !item.isLinkAction) "@$full/" else "@$full "
    return Edit(before + insertion + after, before.length + insertion.length)
  }

  /** Files become mentions, spaces escaped, with a leading space when glued to a word. */
  fun insertingFileMentions(paths: List<String>, text: String, caret: Int): Edit {
    val at = caret.coerceIn(0, text.length)
    val before = text.substring(0, at)
    val after = text.substring(at)
    val needsSpace = before.isNotEmpty() && !before.last().isWhitespace()
    val mentions = paths.joinToString(" ") { "@" + it.replace(" ", "\\ ") }
    val insertion = (if (needsSpace) " " else "") + mentions + " "
    return Edit(before + insertion + after, before.length + insertion.length)
  }

  fun header(context: Context): String = if (isBrowsing(context.query)) splitBrowse(context.query).first else "Files"

  internal fun score(candidate: String, query: String): Int {
    if (query.isEmpty()) return 0
    val lower = candidate.lowercase()
    return when {
      lower == query -> 3
      lower.startsWith(query) -> 2
      query in lower -> 1
      else -> 0
    }
  }

  internal fun basename(path: String) = path.substringAfterLast('/')

  internal fun dirname(path: String) = if ('/' in path) path.substringBeforeLast('/') else ""

  private fun trimSlashes(path: String): String = path.trimEnd('/').ifEmpty { "/" }

  private fun isWhitespace(c: Char) = c == ' ' || c == '\t' || c == '\n' || c == '\r'
}
