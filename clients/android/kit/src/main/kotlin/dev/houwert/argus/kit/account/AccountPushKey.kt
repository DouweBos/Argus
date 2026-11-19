package dev.houwert.argus.kit.account

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.params.HKDFParameters
import org.bouncycastle.math.ec.rfc7748.X25519

/**
 * This install's push key, sealed for one account host. The wrapping key comes from this device's
 * Noise key and the host's, both pinned in the log. Mirrors `services/account/pushKey.ts` (fixture `push_key.json`).
 */
object AccountPushKey {
  private val SALT = "argus-account-pushkey-v1".encodeToByteArray()

  class BadKey : Exception("bad key")

  internal fun wrappingKey(priv: ByteArray, pub: ByteArray, deviceId: String, hostId: String): ByteArray {
    if (priv.size != 32 || pub.size != 32) throw BadKey()
    val shared = ByteArray(32)
    if (!X25519.calculateAgreement(priv, 0, pub, 0, shared, 0)) throw BadKey()
    val hkdf = HKDFBytesGenerator(SHA256Digest())
    hkdf.init(HKDFParameters(shared, SALT, "$deviceId\n$hostId".encodeToByteArray()))
    return ByteArray(32).also { hkdf.generateBytes(it, 0, 32) }
  }

  /** `nonce(12) ‖ ciphertext(32) ‖ tag(16)`, standard base64. */
  fun seal(pushKey: ByteArray, deviceNoisePriv: ByteArray, hostNoisePub: ByteArray, deviceId: String, hostId: String, nonce: ByteArray? = null): String {
    if (pushKey.size != 32) throw BadKey()
    val key = wrappingKey(deviceNoisePriv, hostNoisePub, deviceId, hostId)
    val iv = nonce ?: ByteArray(12).also { SecureRandom().nextBytes(it) }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
    return AccountCodec.b64(iv + cipher.doFinal(pushKey))
  }

  /** What a host does; here so tests can check both directions. */
  fun open(sealed: String, hostNoisePriv: ByteArray, deviceNoisePub: ByteArray, deviceId: String, hostId: String): ByteArray? {
    val blob = AccountCodec.fromB64(sealed)?.takeIf { it.size == 60 } ?: return null
    return runCatching {
      val key = wrappingKey(hostNoisePriv, deviceNoisePub, deviceId, hostId)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, blob.copyOfRange(0, 12)))
      cipher.doFinal(blob.copyOfRange(12, 60))
    }.getOrNull()
  }
}

/** `PUT /push/registration`: this device's token, with its push key sealed per host. */
@Serializable
data class AccountPushRegistration(
  @SerialName("device_id") val deviceId: String,
  /** `apns` or `fcm`. */
  val service: String,
  val token: String,
  /** `production` or `sandbox`. */
  val environment: String,
  /** Host member id → sealed push key. */
  @SerialName("sealed_keys") val sealedKeys: Map<String, String>,
)
