package dev.houwert.argus.kit.account

import java.security.MessageDigest
import java.security.SecureRandom
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer

/**
 * The exact byte strings every account signature covers, and the codecs they
 * rely on. A byte-for-byte mirror of `packages/remote-protocol/src/account/sign.ts`.
 */
object AccountCodec {
  internal const val ENTRY_PREFIX = "argus-account-v1\n"
  internal const val PROOF_PREFIX = "argus-account-proof-v1\n"
  internal const val PRESENCE_PREFIX = "argus-account-presence-v1\n"
  internal const val REQUEST_PREFIX = "argus-account-req-v1\n"

  private val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toSet()

  /** Standard base64 with padding: the only key/signature encoding on the wire. */
  fun b64(data: ByteArray): String = java.util.Base64.getEncoder().encodeToString(data)

  /** Strict decode like the TS `fromB64`: standard or url-safe, padding optional, anything else fails. */
  fun fromB64(value: String): ByteArray? {
    val clean = value.replace('-', '+').replace('_', '/').trimEnd('=')
    if (!clean.all { it in alphabet } || clean.length % 4 == 1) return null
    val padding = (4 - clean.length % 4) % 4
    return runCatching { java.util.Base64.getDecoder().decode(clean + "=".repeat(padding)) }.getOrNull()
  }

  fun hex(data: ByteArray): String = data.joinToString("") { "%02x".format(it.toInt() and 0xff) }

  fun fromHex(value: String): ByteArray? {
    if (value.length % 2 != 0) return null
    return runCatching { ByteArray(value.length / 2) { value.substring(it * 2, it * 2 + 2).toInt(16).toByte() } }
      .getOrNull()
      ?.takeIf { value.all { c -> c.isDigit() || c.lowercaseChar() in 'a'..'f' } }
  }

  fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)
  fun sha256Hex(data: ByteArray): String = hex(sha256(data))
  fun sha256Hex(string: String): String = sha256Hex(string.encodeToByteArray())

  /** `entry_hash`: what the next entry's `prev` names. */
  fun entryHash(body: String): String = sha256Hex(body)

  fun entrySigningBytes(body: String): ByteArray = (ENTRY_PREFIX + body).encodeToByteArray()

  /** A member's key vouching for its own identity (proof of possession). */
  fun proofSigningBytes(id: String, role: String, signPub: String, noisePub: String): ByteArray =
    "$PROOF_PREFIX$id\n$role\n$signPub\n$noisePub".encodeToByteArray()

  fun presenceSigningBytes(body: String): ByteArray = (PRESENCE_PREFIX + body).encodeToByteArray()

  /** What a member signs to authenticate one HTTP request to the service. */
  fun requestSigningBytes(method: String, pathAndQuery: String, ts: Long, body: ByteArray): ByteArray =
    "$REQUEST_PREFIX${method.uppercase()}\n$pathAndQuery\n$ts\n${sha256Hex(body)}".encodeToByteArray()

  /** Never throws: a malformed key or signature is just a failed verify. */
  fun verify(message: ByteArray, signature: String, publicKey: String): Boolean {
    val sig = fromB64(signature) ?: return false
    val pub = fromB64(publicKey) ?: return false
    if (sig.size != 64 || pub.size != 32) return false
    return runCatching {
      val verifier = Ed25519Signer()
      verifier.init(false, Ed25519PublicKeyParameters(pub, 0))
      verifier.update(message, 0, message.size)
      verifier.verifySignature(sig)
    }.getOrDefault(false)
  }

  /** Ed25519 over [message] with a 32-byte seed, base64 out. */
  fun sign(message: ByteArray, seed: ByteArray): String {
    require(seed.size == 32) { "seed must be 32 bytes" }
    val signer = Ed25519Signer()
    signer.init(true, Ed25519PrivateKeyParameters(seed, 0))
    signer.update(message, 0, message.size)
    return b64(signer.generateSignature())
  }

  fun signingPublicKey(seed: ByteArray): String = b64(Ed25519PrivateKeyParameters(seed, 0).generatePublicKey().encoded)

  internal fun randomSeed(): ByteArray = ByteArray(32).also { SecureRandom().nextBytes(it) }

  /** `XXXX-XXXX-XXXX` from the genesis hash, for a by-eye account check. */
  fun safetyCode(genesisHash: String): String {
    val head = genesisHash.take(12).uppercase()
    if (head.length != 12) return head
    return "${head.substring(0, 4)}-${head.substring(4, 8)}-${head.substring(8, 12)}"
  }

  /** A typed link code, normalized: `XXXX-XXXX` from the 20-letter alphabet. */
  fun normalizeUserCode(input: String): String {
    val letters = input.uppercase().filter { it in "BCDFGHJKLMNPQRSTVWXZ" }
    if (letters.length <= 4) return letters
    return letters.take(4) + "-" + letters.drop(4)
  }
}
