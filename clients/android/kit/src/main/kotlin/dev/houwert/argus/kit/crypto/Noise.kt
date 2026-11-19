package dev.houwert.argus.kit.crypto

import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.bouncycastle.crypto.modes.ChaCha20Poly1305
import org.bouncycastle.crypto.params.AEADParameters
import org.bouncycastle.crypto.params.KeyParameter
import org.bouncycastle.math.ec.rfc7748.X25519

/**
 * Noise IK, `25519_ChaChaPoly_SHA256`, with the `psk1` variant used for pairing.
 * Byte-for-byte compatible with `packages/host/src/services/remote/noise.ts` —
 * change both or neither.
 */
private const val HASH_LEN = 32
private const val DH_LEN = 32
private const val TAG_LEN = 16

class NoiseKeypair(val priv: ByteArray, val pub: ByteArray)

enum class NoiseRole { Initiator, Responder }

class NoiseException(val reason: Reason) : Exception(reason.name) {
  enum class Reason {
    NonceExhausted, NotYourTurn, HandshakeIncomplete, MissingRemoteStatic,
    TruncatedMessage, DecryptionFailed, SessionWithoutKeys,
  }
}

object NoiseCrypto {
  private val random = SecureRandom()

  fun generateKeypair(): NoiseKeypair {
    val priv = ByteArray(32).also { X25519.generatePrivateKey(random, it) }
    return NoiseKeypair(priv, publicKey(priv))
  }

  fun publicKey(priv: ByteArray): ByteArray = ByteArray(32).also { X25519.generatePublicKey(priv, 0, it, 0) }

  internal fun dh(kp: NoiseKeypair, pub: ByteArray): ByteArray {
    val out = ByteArray(32)
    if (!X25519.calculateAgreement(kp.priv, 0, pub, 0, out, 0)) {
      throw NoiseException(NoiseException.Reason.DecryptionFailed)
    }
    return out
  }
}

internal fun hmacSha256(key: ByteArray, msg: ByteArray): ByteArray =
  Mac.getInstance("HmacSHA256").run {
    init(SecretKeySpec(key, "HmacSHA256"))
    doFinal(msg)
  }

internal fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)

/** Noise HKDF — HMAC-chained, **not** the RFC-5869 one pairing derives its PSK with. */
internal fun noiseHKDF(chainingKey: ByteArray, ikm: ByteArray, num: Int): List<ByteArray> {
  val temp = hmacSha256(chainingKey, ikm)
  val o1 = hmacSha256(temp, byteArrayOf(1))
  val o2 = hmacSha256(temp, o1 + byteArrayOf(2))
  if (num == 2) return listOf(o1, o2)
  return listOf(o1, o2, hmacSha256(temp, o2 + byteArrayOf(3)))
}

internal class CipherState {
  private var key: ByteArray? = null
  private var n: ULong = 0u

  val hasKey get() = key != null

  fun initializeKey(k: ByteArray?) {
    key = k
    n = 0u
  }

  private fun nonce(): ByteArray {
    val out = ByteArray(12)
    var v = n
    for (i in 4 until 12) {
      out[i] = (v and 0xffu).toByte()
      v = v shr 8
    }
    return out
  }

  private fun run(encrypt: Boolean, ad: ByteArray, input: ByteArray): ByteArray {
    val k = key ?: return input
    if (n == ULong.MAX_VALUE) throw NoiseException(NoiseException.Reason.NonceExhausted)
    if (!encrypt && input.size < TAG_LEN) throw NoiseException(NoiseException.Reason.TruncatedMessage)
    val aead = ChaCha20Poly1305()
    aead.init(encrypt, AEADParameters(KeyParameter(k), TAG_LEN * 8, nonce(), ad))
    val out = ByteArray(aead.getOutputSize(input.size))
    val written = try {
      val len = aead.processBytes(input, 0, input.size, out, 0)
      len + aead.doFinal(out, len)
    } catch (e: Exception) {
      throw NoiseException(NoiseException.Reason.DecryptionFailed)
    }
    n++
    return if (written == out.size) out else out.copyOf(written)
  }

  fun encryptWithAd(ad: ByteArray, plaintext: ByteArray) = run(true, ad, plaintext)

  fun decryptWithAd(ad: ByteArray, ciphertext: ByteArray) = run(false, ad, ciphertext)
}

internal class SymmetricState(protocolName: String) {
  private var h: ByteArray
  private var ck: ByteArray
  val cipher = CipherState()

  init {
    val name = protocolName.toByteArray()
    h = if (name.size <= HASH_LEN) name.copyOf(HASH_LEN) else sha256(name)
    ck = h
  }

  fun mixKey(ikm: ByteArray) {
    val out = noiseHKDF(ck, ikm, 2)
    ck = out[0]
    cipher.initializeKey(out[1].copyOf(32))
  }

  fun mixHash(data: ByteArray) {
    h = sha256(h + data)
  }

  fun mixKeyAndHash(ikm: ByteArray) {
    val out = noiseHKDF(ck, ikm, 3)
    ck = out[0]
    mixHash(out[1])
    cipher.initializeKey(out[2].copyOf(32))
  }

  fun encryptAndHash(plaintext: ByteArray) = cipher.encryptWithAd(h, plaintext).also { mixHash(it) }

  fun decryptAndHash(ciphertext: ByteArray) = cipher.decryptWithAd(h, ciphertext).also { mixHash(ciphertext) }

  val handshakeHash get() = h

  fun split(): Pair<CipherState, CipherState> {
    val out = noiseHKDF(ck, ByteArray(0), 2)
    return CipherState().apply { initializeKey(out[0].copyOf(32)) } to
      CipherState().apply { initializeKey(out[1].copyOf(32)) }
  }
}

class NoiseHandshakeConfig(
  val role: NoiseRole,
  val staticKey: NoiseKeypair,
  /** Required for the initiator (IK pre-message). */
  val remoteStatic: ByteArray? = null,
  /** 32 bytes; enables psk1 (pairing). */
  val psk: ByteArray? = null,
  val prologue: ByteArray? = null,
  /** Test hook: force the ephemeral keypair. */
  val ephemeral: NoiseKeypair? = null,
)

/** Two independent, nonce-counted cipher directions. Not thread-safe: callers serialize. */
class NoiseSession internal constructor(private val send: CipherState, private val recv: CipherState) {
  init {
    // A keyless transport would silently send cleartext.
    if (!send.hasKey || !recv.hasKey) throw NoiseException(NoiseException.Reason.SessionWithoutKeys)
  }

  fun encrypt(plaintext: ByteArray): ByteArray = send.encryptWithAd(ByteArray(0), plaintext)

  fun decrypt(ciphertext: ByteArray): ByteArray = recv.decryptWithAd(ByteArray(0), ciphertext)
}

class NoiseHandshake(cfg: NoiseHandshakeConfig) {
  private val initiator = cfg.role == NoiseRole.Initiator
  private val s = cfg.staticKey
  private val psk = cfg.psk
  private var e = cfg.ephemeral
  private var rs = cfg.remoteStatic
  private var re: ByteArray? = null
  private var messageIndex = 0
  private var transport: Pair<CipherState, CipherState>? = null
  private var hHash: ByteArray? = null
  private val sym: SymmetricState

  init {
    if (initiator && rs == null) throw NoiseException(NoiseException.Reason.MissingRemoteStatic)
    sym = SymmetricState(if (psk != null) "Noise_IKpsk1_25519_ChaChaPoly_SHA256" else "Noise_IK_25519_ChaChaPoly_SHA256")
    sym.mixHash(cfg.prologue ?: ByteArray(0))
    sym.mixHash(if (initiator) rs!! else s.pub)
  }

  val isComplete get() = transport != null

  private fun ephemeral(): NoiseKeypair = e ?: NoiseCrypto.generateKeypair().also { e = it }

  private fun mixDh(a: NoiseKeypair, b: ByteArray) = sym.mixKey(NoiseCrypto.dh(a, b))

  private fun tokens(index: Int): List<String> =
    if (index == 0) {
      if (psk != null) listOf("e", "es", "s", "ss", "psk") else listOf("e", "es", "s", "ss")
    } else {
      listOf("e", "ee", "se")
    }

  fun handshakeHash(): ByteArray = hHash ?: throw NoiseException(NoiseException.Reason.HandshakeIncomplete)

  fun remoteStaticKey(): ByteArray = rs ?: throw NoiseException(NoiseException.Reason.MissingRemoteStatic)

  private fun applyDhToken(token: String) {
    when (token) {
      "ee" -> mixDh(ephemeral(), re!!)
      "es" -> if (initiator) mixDh(ephemeral(), rs!!) else mixDh(s, re!!)
      "se" -> if (initiator) mixDh(s, re!!) else mixDh(ephemeral(), rs!!)
      "ss" -> mixDh(s, rs!!)
      "psk" -> sym.mixKeyAndHash(psk!!)
    }
  }

  fun writeMessage(payload: ByteArray): ByteArray {
    val isWriter = (messageIndex == 0 && initiator) || (messageIndex == 1 && !initiator)
    if (!isWriter) throw NoiseException(NoiseException.Reason.NotYourTurn)
    var buf = ByteArray(0)
    for (token in tokens(messageIndex)) {
      when (token) {
        "e" -> {
          val eph = ephemeral()
          buf += eph.pub
          sym.mixHash(eph.pub)
          if (psk != null) sym.mixKey(eph.pub)
        }
        "s" -> buf += sym.encryptAndHash(s.pub)
        else -> applyDhToken(token)
      }
    }
    buf += sym.encryptAndHash(payload)
    finishMessage()
    return buf
  }

  fun readMessage(message: ByteArray): ByteArray {
    val isReader = (messageIndex == 0 && !initiator) || (messageIndex == 1 && initiator)
    if (!isReader) throw NoiseException(NoiseException.Reason.NotYourTurn)
    var offset = 0
    for (token in tokens(messageIndex)) {
      when (token) {
        "e" -> {
          if (message.size - offset < DH_LEN) throw NoiseException(NoiseException.Reason.TruncatedMessage)
          val value = message.copyOfRange(offset, offset + DH_LEN)
          offset += DH_LEN
          re = value
          sym.mixHash(value)
          if (psk != null) sym.mixKey(value)
        }
        "s" -> {
          val len = if (sym.cipher.hasKey) DH_LEN + TAG_LEN else DH_LEN
          if (message.size - offset < len) throw NoiseException(NoiseException.Reason.TruncatedMessage)
          rs = sym.decryptAndHash(message.copyOfRange(offset, offset + len))
          offset += len
        }
        else -> applyDhToken(token)
      }
    }
    val payload = sym.decryptAndHash(message.copyOfRange(offset, message.size))
    finishMessage()
    return payload
  }

  private fun finishMessage() {
    messageIndex++
    if (messageIndex != 2) return
    val (c1, c2) = sym.split()
    hHash = sym.handshakeHash
    // c1 encrypts initiator→responder; c2 the reverse.
    transport = if (initiator) c1 to c2 else c2 to c1
  }

  fun session(): NoiseSession {
    val (send, recv) = transport ?: throw NoiseException(NoiseException.Reason.HandshakeIncomplete)
    return NoiseSession(send, recv)
  }
}
