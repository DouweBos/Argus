package dev.houwert.argus.kit.account

import dev.houwert.argus.kit.crypto.ArgusDerive
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/**
 * The 6-digit code both sides of an account approval compare. It binds the
 * approver, the subject's keys and the log head, so a swapped key or fork gives a different code. Mirrors `account/sas.ts`.
 */
data class AccountSas(val sas: String, /** Written into the `add_*` entry so the subject can check what it confirmed. */ val commit: String) {
  data class Input(
    val accountId: String,
    val epoch: Int,
    val headHash: String,
    val approverSignPub: String,
    val subjectSignPub: String,
    val subjectNoisePub: String,
    val requestId: String,
  )

  class BadEncoding : Exception("bad encoding")

  companion object {
    fun compute(input: Input): AccountSas {
      val digest = AccountCodec.sha256(transcript(input))
      return AccountSas(ArgusDerive.sas(digest), AccountCodec.hex(digest))
    }

    internal fun transcript(input: Input): ByteArray {
      val head = AccountCodec.fromHex(input.headHash) ?: throw BadEncoding()
      val approver = AccountCodec.fromB64(input.approverSignPub) ?: throw BadEncoding()
      val subjectSign = AccountCodec.fromB64(input.subjectSignPub) ?: throw BadEncoding()
      val subjectNoise = AccountCodec.fromB64(input.subjectNoisePub) ?: throw BadEncoding()
      if (input.epoch < 0) throw BadEncoding()
      val out = ByteArrayOutputStream()
      for (part in listOf(
        "argus-account-sas-v1".encodeToByteArray(), input.accountId.encodeToByteArray(), u32be(input.epoch.toLong()), head,
        approver, subjectSign, subjectNoise, input.requestId.encodeToByteArray(),
      )) {
        out.write(u32be(part.size.toLong()))
        out.write(part)
      }
      return out.toByteArray()
    }

    private fun u32be(n: Long): ByteArray = ByteBuffer.allocate(4).putInt(n.toInt()).array()
  }
}
