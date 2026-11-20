package dev.houwert.argus.kit.push

import dev.houwert.argus.kit.crypto.ArgusBase64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class SealedNotificationAction(val id: String, val title: String)

/**
 * A notification the desktop sealed for this device, so the relay forwarding it
 * never learns what an agent is doing. Matches `push/seal.ts`'s `SealedNotification`.
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class SealedNotification(
  val title: String,
  val body: String,
  val kind: String,
  @EncodeDefault val agentId: String? = null,
  @EncodeDefault val sessionId: String? = null,
  @EncodeDefault val toolUseId: String? = null,
  val actions: List<SealedNotificationAction> = emptyList(),
)

/**
 * Format: base64 of `nonce(12) ‖ ciphertext ‖ tag(16)`, AES-256-GCM, matching
 * `packages/host/src/services/remote/push/seal.ts`.
 */
object ArgusSeal {
  private val json = Json { ignoreUnknownKeys = true }

  /** The opened notification, or null; failures are silent so a vague alert beats ciphertext. */
  fun open(sealed: String, pushKeyBase64: String): SealedNotification? {
    val plaintext = openData(sealed, pushKeyBase64) ?: return null
    return runCatching { json.decodeFromString(SealedNotification.serializer(), plaintext.decodeToString()) }.getOrNull()
  }

  fun openData(sealed: String, pushKeyBase64: String): ByteArray? {
    val key = ArgusBase64.decode(pushKeyBase64)?.takeIf { it.size == 32 } ?: return null
    // 12-byte nonce + 16-byte tag, so anything shorter can't be one of ours.
    val blob = ArgusBase64.decode(sealed)?.takeIf { it.size > 28 } ?: return null
    return runCatching {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, blob, 0, 12))
      cipher.doFinal(blob, 12, blob.size - 12)
    }.getOrNull()
  }

  /** Tests only: the desktop does the real sealing. */
  fun seal(notification: SealedNotification, pushKeyBase64: String, nonce: ByteArray): String =
    seal(json.encodeToString(SealedNotification.serializer(), notification).encodeToByteArray(), pushKeyBase64, nonce)

  fun seal(plaintext: ByteArray, pushKeyBase64: String, nonce: ByteArray): String {
    val key = ArgusBase64.decode(pushKeyBase64)?.takeIf { it.size == 32 } ?: error("push key must be 32 bytes")
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
    return ArgusBase64.encode(nonce + cipher.doFinal(plaintext))
  }

  /** The desktop's `collapseId`: HMAC so the relay learns nothing from the grouping itself. */
  fun collapseId(pushKeyBase64: String, subject: String): String? {
    val key = ArgusBase64.decode(pushKeyBase64) ?: return null
    val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }
    return ArgusBase64.encodeURL(mac.doFinal(subject.encodeToByteArray())).take(22)
  }

  /** What a notification may replace in the shade, or null to let it stack; mirrors `collapseSubject`. */
  fun collapseSubject(kind: String, agentId: String?, toolUseId: String?): String? = when (kind) {
    "failed", "finished" -> agentId?.let { "agent-$it" }
    "permission" -> toolUseId?.let { "prompt-$it" }
    else -> null
  }
}
