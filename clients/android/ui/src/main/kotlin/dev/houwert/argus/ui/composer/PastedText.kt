package dev.houwert.argus.ui.composer

/** The text a paste carries next to its images. */
object PastedText {
  /** [text] to insert beside pasted images, or null when it only names them (a file name or an image URL). */
  fun besideImages(text: String?, names: List<String>): String? {
    if (text.isNullOrBlank()) return null
    val known = names.map { it.trim() }.toSet()
    val lines = text.lines().map { it.trim() }.filter { it.isNotEmpty() }
    return if (lines.all { it in known }) null else text
  }
}
