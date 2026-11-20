package dev.houwert.argus.ui.composer

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import dev.houwert.argus.kit.protocol.generated.RemoteImageAttachment
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.UUID

/** An image waiting to go out with the next message; the preview decodes from `attachment` where it's drawn. */
data class PendingImage(val attachment: RemoteImageAttachment, val id: String = UUID.randomUUID().toString())

/**
 * Turns pasted, picked and shot images into the `{data, media_type}` attachment every client
 * sends. Accepted formats go out byte for byte; anything else (HEIC, BMP) is re-encoded.
 */
object ImageAttachments {
  /** What the picker offers and what passes through untouched. */
  val acceptedTypes = listOf("image/png", "image/jpeg", "image/gif", "image/webp")

  private val imageExtensions = setOf("png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff", "avif")

  fun isImage(name: String) = name.substringAfterLast('.', "").lowercase() in imageExtensions

  /** The format named by the bytes themselves, for sources that don't say (or lie). */
  fun sniff(data: ByteArray): String? {
    fun at(offset: Int, vararg bytes: Int) =
      data.size >= offset + bytes.size && bytes.indices.all { data[offset + it] == bytes[it].toByte() }
    return when {
      at(0, 0x89, 0x50, 0x4E, 0x47) -> "image/png"
      at(0, 0xFF, 0xD8, 0xFF) -> "image/jpeg"
      at(0, 0x47, 0x49, 0x46, 0x38) -> "image/gif"
      at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50) -> "image/webp"
      else -> null
    }
  }

  /**
   * Accepted bytes as they are; any other image through [reencode] (JPEG by default, as the
   * photo library's HEIC arrives on the iPhone). Null for bytes that aren't an image.
   */
  fun pending(
    data: ByteArray,
    reencode: (ByteArray) -> ByteArray? = ::jpegFromAny,
  ): PendingImage? {
    sniff(data)?.let { return PendingImage(attachment(data, it)) }
    val jpeg = reencode(data) ?: return null
    return PendingImage(attachment(jpeg, "image/jpeg"))
  }

  /** A camera frame has no source bytes; JPEG keeps it under the gateway's frame limit. */
  fun pending(photo: Bitmap): PendingImage? = encode(photo, Bitmap.CompressFormat.JPEG, 80)?.let { PendingImage(attachment(it, "image/jpeg")) }

  /** A pasted image with no source bytes, as lossless PNG. */
  fun pendingPasted(image: Bitmap): PendingImage? = encode(image, Bitmap.CompressFormat.PNG, 100)?.let { PendingImage(attachment(it, "image/png")) }

  fun attachment(data: ByteArray, mimeType: String) =
    RemoteImageAttachment(data = Base64.getEncoder().encodeToString(data), mediaType = mimeType)

  fun decode(attachment: RemoteImageAttachment): ByteArray? = runCatching { Base64.getDecoder().decode(attachment.data) }.getOrNull()

  private fun jpegFromAny(data: ByteArray): ByteArray? =
    BitmapFactory.decodeByteArray(data, 0, data.size)?.let { encode(it, Bitmap.CompressFormat.JPEG, 85) }

  private fun encode(bitmap: Bitmap, format: Bitmap.CompressFormat, quality: Int): ByteArray? {
    val out = ByteArrayOutputStream()
    return if (bitmap.compress(format, quality, out)) out.toByteArray() else null
  }
}
