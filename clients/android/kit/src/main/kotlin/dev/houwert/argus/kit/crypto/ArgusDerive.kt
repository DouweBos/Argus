package dev.houwert.argus.kit.crypto

import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.params.HKDFParameters

/** Mirror of `packages/host/src/services/remote/derive.ts`; drift breaks pairing. */
object ArgusDerive {
  private const val PAIRING_INFO = "argus-pair-v1"

  /** RFC-5869 HKDF — deliberately not the Noise HKDF. */
  fun pairingPSK(pairingSecret: ByteArray): ByteArray {
    val gen = HKDFBytesGenerator(SHA256Digest())
    gen.init(HKDFParameters(pairingSecret, ByteArray(0), PAIRING_INFO.toByteArray()))
    return ByteArray(32).also { gen.generateBytes(it, 0, 32) }
  }

  /** The 6-digit short authentication string both ends show before pairing. */
  fun sas(handshakeHash: ByteArray): String {
    val d = sha256(handshakeHash)
    var code = 0L
    for (i in 0 until 4) code = (code shl 8) or (d[i].toLong() and 0xff)
    return "%06d".format(code % 1_000_000)
  }
}
