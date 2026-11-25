package dev.houwert.argus.core.files

import java.net.URI
import java.net.URLDecoder

/** What a file viewer renders instead of (or next to) its source. */
enum class FilePreviewKind(val wire: String) {
  Markdown("markdown"),
  Pdf("pdf"),
  Image("image"),
  /** Too large to open whole, so paged; never from an extension. */
  Large("large");

  /** Read as bytes rather than text: the host calls these binary. */
  val isBinary: Boolean get() = this == Pdf || this == Image

  companion object {
    fun of(path: String): FilePreviewKind? = when (extension(path)) {
      "md", "mdx", "markdown" -> Markdown
      "pdf" -> Pdf
      "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic", "tif", "tiff", "ico" -> Image
      else -> null
    }

    fun isSvg(path: String): Boolean = extension(path) == "svg"

    private fun extension(path: String): String {
      val name = SessionFilePaths.fileName(path)
      val dot = name.lastIndexOf('.')
      return if (dot <= 0) "" else name.substring(dot + 1).lowercase()
    }
  }
}

/** Where a link or an image in a previewed Markdown file points. */
sealed interface MarkdownTarget {
  /** A worktree-relative file, and the line a `#L12` fragment names. */
  data class File(val path: String, val line: Int? = null) : MarkdownTarget

  /** `#heading` within the same document. */
  data class Anchor(val id: String) : MarkdownTarget

  data class External(val url: String) : MarkdownTarget

  companion object {
    private val lineFragment = Regex("""L(\d+)(-L?\d+)?""")
    private val scheme = Regex("""^([a-zA-Z][a-zA-Z0-9+.-]*):""")

    /**
     * [href] as written in the document at [documentPath] (worktree-relative). Null when it climbs
     * out of the worktree or names a scheme other than http(s) or mailto.
     */
    fun resolve(href: String, documentPath: String): MarkdownTarget? {
      val trimmed = href.trim()
      if (trimmed.isEmpty()) return null
      if (trimmed.startsWith("#")) return Anchor(trimmed.drop(1))
      scheme.find(trimmed)?.let { match ->
        val name = match.groupValues[1].lowercase()
        if (name !in setOf("http", "https", "mailto")) return null
        return runCatching { URI(trimmed) }.getOrNull()?.let { External(trimmed) }
      }
      var path = trimmed
      var line: Int? = null
      val hash = path.indexOf('#')
      if (hash >= 0) {
        line = lineFragment.matchEntire(path.substring(hash + 1))?.groupValues?.get(1)?.toIntOrNull()
        path = path.substring(0, hash)
      }
      path = path.substringBefore('?')
      path = runCatching { URLDecoder.decode(path.replace("+", "%2B"), "UTF-8") }.getOrDefault(path)
      val joined = if (path.startsWith("/")) path else {
        val directory = SessionFilePaths.directory(documentPath)
        if (directory.isEmpty()) path else "$directory/$path"
      }
      val normalized = SessionFilePaths.normalized(joined) ?: return null
      return File(normalized, line)
    }

    /** GitHub's heading anchor: lower case, punctuation dropped, spaces to dashes. */
    fun anchor(heading: String): String =
      heading.replace(Regex("""[`*_~\[\]()]"""), "").lowercase()
        .mapNotNull { c -> if (c == ' ') '-' else c.takeIf { it == '-' || it.isLetterOrDigit() } }
        .joinToString("")
  }
}

/** `![alt](src)` standing alone in a paragraph, as READMEs put screenshots and badges. */
object MarkdownImageLine {
  data class Image(val alt: String, val source: String)

  private val image = Regex("""!\[([^\]]*)]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)""")

  /** The images when the paragraph is nothing but images; null otherwise. */
  fun images(paragraph: String): List<Image>? {
    val images = mutableListOf<Image>()
    var rest = 0
    for (match in image.findAll(paragraph)) {
      if (paragraph.substring(rest, match.range.first).isNotBlank()) return null
      images += Image(match.groupValues[1], match.groupValues[2])
      rest = match.range.last + 1
    }
    return if (images.isEmpty() || paragraph.substring(rest).isNotBlank()) null else images
  }
}

/** A GFM task item's box: `[ ] `, `[x] `. */
object MarkdownTask {
  data class Item(val checked: Boolean, val text: String)

  private val box = Regex("""^\[([ xX])]\s+""")

  fun split(item: String): Item? {
    val match = box.find(item) ?: return null
    return Item(match.groupValues[1] != " ", item.substring(match.range.last + 1))
  }
}
