package dev.houwert.argus.ui.transcript

import java.util.Base64
import kotlin.math.roundToInt

/** A transcript image's bytes and type, parsed once for whichever viewer shows it. */
class ImageViewerItem(val imageId: String, dataUri: String?) {
  private val parsed = dataUri?.let(::parse)
  val data: ByteArray? = parsed?.first
  val mediaType: String = parsed?.second ?: "image/png"

  /** A name to save or share it under; ids carry `:` and `/`. */
  val fileName: String
    get() {
      val ext = mediaType.substringAfterLast('/').let { if (it == "jpeg") "jpg" else it }
      return "argus-${imageId.replace(':', '-').replace('/', '-')}.$ext"
    }

  data class Size(val width: Int, val height: Int)

  companion object {
    /** `data:<mime>;base64,…`; a bare `…,<base64>` decodes as PNG. */
    fun parse(uri: String): Pair<ByteArray, String>? {
      val comma = uri.indexOf(',').takeIf { it >= 0 } ?: return null
      val data = runCatching { Base64.getDecoder().decode(uri.substring(comma + 1)) }.getOrNull() ?: return null
      val header = if (uri.startsWith("data:")) uri.substring(5, comma) else ""
      val mediaType = header.substringBefore(';').takeIf { '/' in it } ?: "image/png"
      return data to mediaType
    }

    /** Within [room], never past the image's own size. */
    fun fit(width: Int, height: Int, room: Size): Size {
      if (width <= 0 || height <= 0) return Size(240, 160)
      val scale = minOf(1.0, room.width.toDouble() / width, room.height.toDouble() / height)
      return Size(maxOf(1, (width * scale).roundToInt()), maxOf(1, (height * scale).roundToInt()))
    }
  }
}
