package dev.houwert.argus.kit.util

/**
 * Links and text shared into Argus, as the start composer's opening draft: each link on a line
 * of its own, text quoted, then room for the prompt.
 */
object SharedPrompt {
  fun draft(links: List<String>, texts: List<String>): String {
    val urls = mutableListOf<String>()
    val quotes = mutableListOf<String>()
    for (link in links.map { it.trim() }) {
      if (link.isNotEmpty() && link !in urls) urls.add(link)
    }
    for (text in texts.map { it.trim() }) {
      if (text.isEmpty()) continue
      // Slack and others share a link as plain text.
      if (isLink(text)) {
        if (text !in urls) urls.add(text)
      } else if (text !in quotes) {
        quotes.add(text)
      }
    }
    val blocks = urls + quotes.map(::quote)
    return if (blocks.isEmpty()) "" else blocks.joinToString("\n\n") + "\n\n"
  }

  fun isLink(text: String): Boolean {
    if (text.any { it.isWhitespace() }) return false
    val uri = parseUri(text) ?: return false
    val scheme = uri.scheme?.lowercase() ?: return false
    return (scheme == "http" || scheme == "https") && uri.host != null
  }

  internal fun quote(text: String): String =
    text.split("\n").joinToString("\n") { if (it.isEmpty()) ">" else "> $it" }
}
