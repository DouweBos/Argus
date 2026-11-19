package dev.houwert.argus.kit.crypto

import java.util.Base64

/**
 * Lenient on read, strict on write: the TS decoder strips anything outside the
 * alphabet, so a pairing code pasted with a stray newline must still decode.
 */
object ArgusBase64 {
  private val alphabet = ("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/").toSet()

  fun encode(data: ByteArray): String = Base64.getEncoder().encodeToString(data)

  fun decode(string: String): ByteArray? {
    val cleaned = string.filter { it in alphabet }
    // A remainder of 1 can never be valid base64, padded or not.
    if (cleaned.length % 4 == 1) return null
    return runCatching { Base64.getDecoder().decode(cleaned + "=".repeat((4 - cleaned.length % 4) % 4)) }
      .getOrNull()
  }

  fun encodeURL(data: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(data)

  fun decodeURL(string: String): ByteArray? = decode(string.replace('-', '+').replace('_', '/'))
}
