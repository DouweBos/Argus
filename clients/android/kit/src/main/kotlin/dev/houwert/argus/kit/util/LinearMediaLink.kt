package dev.houwert.argus.kit.util

/** A Linear upload (screenshot or recording) on a line of its own, which an issue page shows inline. */
data class LinearMediaLink(val kind: Kind, val url: String, val label: String) {
  enum class Kind { IMAGE, VIDEO }

  /** Part of a paragraph: plain markdown, or an upload to embed. */
  sealed interface Segment {
    data class Text(val text: String) : Segment
    data class Media(val media: LinearMediaLink) : Segment
  }

  companion object {
    private val videoExtensions = setOf("mov", "mp4", "m4v", "webm")

    fun isLinearUpload(url: String): Boolean = urlHost(url)?.lowercase() == "uploads.linear.app"

    /**
     * `![label](url)` or `[label](url)` filling the whole line, when it's a Linear upload Argus
     * can show: any image, and links whose text or path names a video.
     */
    fun parse(line: String): LinearMediaLink? {
      var rest = line.trimSpaces()
      val isImage = rest.startsWith("!")
      if (isImage) rest = rest.drop(1)
      val close = rest.indexOf("](")
      if (!rest.startsWith("[") || !rest.endsWith(")") || close < 0) return null
      val label = rest.substring(1, close)
      if (label.contains(']')) return null
      var target = rest.substring(close + 2, rest.length - 1).trimSpaces()
      // An optional `"title"` after the URL.
      target = target.substringBefore(' ')
      if (!isLinearUpload(target)) return null
      if (isImage) return LinearMediaLink(Kind.IMAGE, target, label)
      val path = parseUri(target)?.path ?: ""
      val named = listOf(label, path).any { pathExtension(it).lowercase() in videoExtensions }
      return if (named) LinearMediaLink(Kind.VIDEO, target, label) else null
    }

    /** Splits a paragraph around its upload lines; a paragraph without any is one text segment. */
    fun segments(paragraph: String): List<Segment> {
      val segments = mutableListOf<Segment>()
      val text = mutableListOf<String>()
      fun flush() {
        if (text.isNotEmpty()) segments.add(Segment.Text(text.joinToString("\n")))
        text.clear()
      }
      for (line in paragraph.split("\n")) {
        val media = parse(line)
        if (media != null) {
          flush()
          segments.add(Segment.Media(media))
        } else {
          text.add(line)
        }
      }
      flush()
      return segments
    }
  }
}
