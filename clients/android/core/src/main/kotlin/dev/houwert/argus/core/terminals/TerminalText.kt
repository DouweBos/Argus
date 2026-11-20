package dev.houwert.argus.core.terminals

/**
 * A terminal's output as plain text, built up from raw PTY chunks: escape
 * sequences dropped, a bare carriage return redrawing its line the way a
 * progress bar means it to. Colours stay with the desktop.
 */
class TerminalText(private val limit: Int = 64 * 1024) {
  private val buffer = StringBuilder()
  val text: String get() = buffer.toString()
  /** Older output was dropped, here or by the host's capture. */
  var truncated = false

  /** Bytes of a UTF-8 character or escape sequence split across chunks. */
  private var pending = ByteArray(0)

  fun reset() {
    buffer.setLength(0)
    truncated = false
    pending = ByteArray(0)
  }

  fun append(data: ByteArray) {
    var bytes = pending + data
    pending = ByteArray(0)
    // Hold back an incomplete trailing UTF-8 sequence.
    var split = bytes.size
    for (offset in 1..minOf(3, bytes.size)) {
      val byte = bytes[bytes.size - offset].toInt() and 0xFF
      if (byte and 0xC0 == 0x80) continue
      val need = if (byte >= 0xF0) 4 else if (byte >= 0xE0) 3 else if (byte >= 0xC0) 2 else 1
      if (need > offset) split = bytes.size - offset
      break
    }
    pending = bytes.copyOfRange(split, bytes.size)
    bytes = bytes.copyOfRange(0, split)
    write(String(bytes, Charsets.UTF_8))
  }

  private fun write(chunk: String) {
    val s = chunk.codePoints().toArray().toMutableList()
    val out = StringBuilder()
    var i = 0
    fun flush() {
      if (out.isNotEmpty()) { buffer.append(out); out.setLength(0) }
    }
    while (i < s.size) {
      when (s[i]) {
        0x1B -> {
          val end = escapeEnd(s, i)
          if (end == null) {
            // Unfinished: keep it for the next chunk.
            val rest = s.subList(i, s.size).joinToString("") { String(Character.toChars(it)) }
            pending = rest.toByteArray(Charsets.UTF_8) + pending
            break
          }
          i = end
        }
        '\r'.code -> when {
          i + 1 < s.size && s[i + 1] == '\n'.code -> { out.append('\n'); i += 2 }
          i + 1 == s.size -> {
            // Can't tell a CRLF split across chunks from a redraw yet.
            pending = "\r".toByteArray() + pending
            i += 1
          }
          else -> {
            flush()
            val newline = buffer.lastIndexOf("\n")
            buffer.setLength(if (newline >= 0) newline + 1 else 0)
            i += 1
          }
        }
        0x08 -> {
          flush()
          if (buffer.isNotEmpty() && buffer.last() != '\n') buffer.setLength(buffer.length - 1)
          i += 1
        }
        0x07 -> i += 1
        else -> { out.appendCodePoint(s[i]); i += 1 }
      }
    }
    flush()
    trim()
  }

  /** Keeps the tail, from a line start. */
  private fun trim() {
    val utf8 = buffer.toString().toByteArray(Charsets.UTF_8)
    if (utf8.size <= limit) return
    var kept = String(utf8.copyOfRange(utf8.size - limit, utf8.size), Charsets.UTF_8)
    val newline = kept.indexOf('\n')
    if (newline >= 0) kept = kept.substring(newline + 1)
    buffer.setLength(0)
    buffer.append(kept)
    truncated = true
  }

  companion object {
    /** Index just past the escape sequence starting at [start], or null when the chunk ends inside it. CSI, OSC and two-character escapes. */
    fun escapeEnd(s: List<Int>, start: Int): Int? {
      var i = start + 1
      if (i >= s.size) return null
      when (s[i]) {
        '['.code -> {
          i += 1
          while (i < s.size) {
            if (s[i] in 0x40..0x7E) return i + 1
            i += 1
          }
          return null
        }
        ']'.code -> {
          i += 1
          while (i < s.size) {
            if (s[i] == 0x07) return i + 1
            if (s[i] == 0x1B) {
              if (i + 1 >= s.size) return null
              if (s[i + 1] == '\\'.code) return i + 2
            }
            i += 1
          }
          return null
        }
        '('.code, ')'.code -> return if (i + 1 < s.size) i + 2 else null
        else -> return i + 1
      }
    }
  }
}
