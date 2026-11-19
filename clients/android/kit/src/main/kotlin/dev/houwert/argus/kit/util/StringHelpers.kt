package dev.houwert.argus.kit.util

import java.net.URI

// Stand-ins for the Foundation URL/NSString helpers the Swift utilities lean on.

/** The host of an absolute URL, or null when it doesn't parse or has none (`URL(string:)?.host()`). */
internal fun urlHost(raw: String): String? = parseUri(raw)?.host

internal fun parseUri(raw: String): URI? = runCatching { URI(raw) }.getOrNull()

/** `NSString.lastPathComponent`, minus its handling of trailing slashes. */
internal fun lastPathComponent(path: String): String = path.trimEnd('/').substringAfterLast('/')

/** `NSString.pathExtension`: what follows the last dot of the last component; a leading dot is not one. */
internal fun pathExtension(path: String): String {
  val name = lastPathComponent(path)
  val dot = name.lastIndexOf('.')
  return if (dot <= 0) "" else name.substring(dot + 1)
}

/** `NSString.deletingPathExtension` on a bare file name. */
internal fun deletingPathExtension(name: String): String {
  val dot = name.lastIndexOf('.')
  return if (dot <= 0) name else name.substring(0, dot)
}

/** Swift's `trimmingCharacters(in: .whitespaces)`: spaces and tabs, but not line breaks. */
internal fun String.trimSpaces(): String = trim { it == ' ' || it == '\t' || Character.getType(it) == Character.SPACE_SEPARATOR.toInt() }

/** Clips to [max] characters, marking the cut. */
internal fun clip(text: String, max: Int): String = if (text.length > max) text.take(max) + "…" else text
