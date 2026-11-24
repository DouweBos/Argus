package dev.houwert.argus.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import dev.houwert.argus.kit.protocol.generated.TeammateColor

/** Syntax colours, one per capture; twins of `Theme+Syntax.swift`. */
@Immutable
data class SyntaxPalette(
  val keyword: Color,
  val string: Color,
  val comment: Color,
  val type: Color,
  val function: Color,
  val number: Color,
  val constant: Color,
  val variable: Color,
  val property: Color,
  val operator: Color,
  val punctuation: Color,
  val tag: Color,
  val attribute: Color,
  val escape: Color,
  val regex: Color,
  val heading: Color,
  val link: Color,
) {
  companion object {
    val Dark =
      SyntaxPalette(
        keyword = hex(0xB59CFF), string = hex(0x9CDB8F), comment = hex(0x7A8290), type = hex(0x5CCFE6),
        function = hex(0x82AAFF), number = hex(0xFFB454), constant = hex(0xF78C6C), variable = hex(0xE4E4EA),
        property = hex(0x7FD8C4), operator = hex(0x89DDFF), punctuation = hex(0x9BA1AD), tag = hex(0xFF6B8B),
        attribute = hex(0xFFCB6B), escape = hex(0xFF9CAC), regex = hex(0xF07178), heading = hex(0xF5A623),
        link = hex(0x5CCFE6),
      )
    val Light =
      SyntaxPalette(
        keyword = hex(0x8E3CCB), string = hex(0x3A7D22), comment = hex(0x6B7280), type = hex(0x0B7A8F),
        function = hex(0x2457C5), number = hex(0xB25E00), constant = hex(0xC2410C), variable = hex(0x1F2328),
        property = hex(0x0F766E), operator = hex(0x0E7490), punctuation = hex(0x57606A), tag = hex(0xC21E56),
        attribute = hex(0xA16207), escape = hex(0xB4235A), regex = hex(0xB42318), heading = hex(0xB4690E),
        link = hex(0x0B7A8F),
      )
  }
}

/**
 * A stable colour per project, from a hash of its path. Same palette and hash as the
 * desktop app, so a project wears the same colour everywhere.
 */
object ProjectAccent {
  private val palette =
    intArrayOf(0x4D9FFF, 0x7C5CFC, 0x00D4AA, 0xF5A623, 0xFF4466, 0xFF7A59, 0x22C55E, 0xE879F9, 0x06B6D4, 0xFACC15)

  fun color(path: String): Color = hex(palette[index(path)])

  fun index(path: String): Int = if (path.isEmpty()) 0 else (fnv1a(path).toLong() and 0xFFFFFFFFL).rem(palette.size).toInt()

  /** FNV-1a over UTF-16 code units, matching JavaScript's `charCodeAt`. */
  fun fnv1a(input: String): Int {
    var hash = 0x811C9DC5.toInt()
    for (unit in input) {
      hash = hash xor unit.code
      hash += (hash shl 1) + (hash shl 4) + (hash shl 7) + (hash shl 8) + (hash shl 24)
    }
    return hash
  }
}

/** The commit graph's lane colours, a twin of Peacock's `LANE_COLORS`; the same in both schemes. */
object GitGraphPalette {
  val lanes: List<Color> =
    listOf(0xE06C75, 0xE5C07B, 0x98C379, 0x61AFEF, 0xC678DD, 0x56B6C2, 0xD19A66, 0xBE5046).map(::hex)

  /** A lane's colour; indices wrap around the palette. */
  fun lane(index: Int): Color = lanes[((index % lanes.size) + lanes.size) % lanes.size]
}

/** A teammate's colour, a twin of ArgusUI's `TeammateColor` tokens; the same in both schemes. */
object TeammatePalette {
  val blue = hex(0x4D9FFF)
  val green = hex(0x22C55E)
  val orange = hex(0xFF7A59)
  val pink = hex(0xE879F9)
  val purple = hex(0x7C5CFC)
  val red = hex(0xFF4466)
  val teal = hex(0x00D4AA)
  val yellow = hex(0xF5A623)

  /** An unknown colour from a newer host reads as blue. */
  fun color(color: TeammateColor): Color = when (color) {
    TeammateColor.green -> green
    TeammateColor.orange -> orange
    TeammateColor.pink -> pink
    TeammateColor.purple -> purple
    TeammateColor.red -> red
    TeammateColor.teal -> teal
    TeammateColor.yellow -> yellow
    else -> blue
  }
}
