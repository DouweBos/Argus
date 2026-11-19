package dev.houwert.argus.kit.crypto

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Vectors from the host's own `noise.ts`: if these fail, no handshake completes. */
class NoiseInteropTest {
  @Serializable
  data class Run(
    val psk: String? = null,
    val iStaticPriv: String, val iStaticPub: String, val rStaticPriv: String, val rStaticPub: String,
    val iEphPriv: String, val rEphPriv: String, val msg0: String, val msg1: String,
    val handshakeHash: String, val responderHandshakeHash: String, val sas: String,
    val ct1: String, val pt1: String, val ct2: String, val pt2: String, val ct3: String,
    val remoteStaticSeenByResponder: String,
  )

  @Serializable
  data class Vectors(val ik: Run, val ikpsk1: Run, val pairingPsk: String, val sasOfZeros: String)

  private val v: Vectors = Json { ignoreUnknownKeys = true }.decodeFromString(
    javaClass.getResource("/noise-vectors.json")!!.readText(),
  )

  private fun b64(s: String) = ArgusBase64.decode(s)!!
  private fun kp(priv: String) = b64(priv).let { NoiseKeypair(it, NoiseCrypto.publicKey(it)) }
  private fun runs() = listOf(v.ik, v.ikpsk1)

  @Test fun publicKeys() {
    assertEquals(v.ik.iStaticPub, ArgusBase64.encode(NoiseCrypto.publicKey(b64(v.ik.iStaticPriv))))
    assertEquals(v.ik.rStaticPub, ArgusBase64.encode(NoiseCrypto.publicKey(b64(v.ik.rStaticPriv))))
  }

  @Test fun pairingPsk() {
    assertEquals(v.pairingPsk, ArgusBase64.encode(ArgusDerive.pairingPSK(ByteArray(32) { 9 })))
  }

  @Test fun sas() {
    assertEquals(v.sasOfZeros, ArgusDerive.sas(ByteArray(32)))
    runs().forEach { assertEquals(it.sas, ArgusDerive.sas(b64(it.handshakeHash))) }
  }

  @Test fun initiatorBytes() = runs().forEach { r ->
    val hs = NoiseHandshake(NoiseHandshakeConfig(NoiseRole.Initiator, kp(r.iStaticPriv), b64(r.rStaticPub), r.psk?.let(::b64), ephemeral = kp(r.iEphPriv)))
    assertEquals(r.msg0, ArgusBase64.encode(hs.writeMessage(ByteArray(0))))
    assertTrue(hs.readMessage(b64(r.msg1)).isEmpty())
    assertEquals(r.handshakeHash, ArgusBase64.encode(hs.handshakeHash()))
  }

  @Test fun responderBytes() = runs().forEach { r ->
    val hs = NoiseHandshake(NoiseHandshakeConfig(NoiseRole.Responder, kp(r.rStaticPriv), psk = r.psk?.let(::b64), ephemeral = kp(r.rEphPriv)))
    assertTrue(hs.readMessage(b64(r.msg0)).isEmpty())
    assertEquals(r.remoteStaticSeenByResponder, ArgusBase64.encode(hs.remoteStaticKey()))
    assertEquals(r.msg1, ArgusBase64.encode(hs.writeMessage(ByteArray(0))))
    assertEquals(r.responderHandshakeHash, ArgusBase64.encode(hs.handshakeHash()))
  }

  @Test fun transport() = runs().forEach { r ->
    val hs = NoiseHandshake(NoiseHandshakeConfig(NoiseRole.Initiator, kp(r.iStaticPriv), b64(r.rStaticPub), r.psk?.let(::b64), ephemeral = kp(r.iEphPriv)))
    hs.writeMessage(ByteArray(0))
    hs.readMessage(b64(r.msg1))
    val s = hs.session()
    assertEquals(r.ct1, ArgusBase64.encode(s.encrypt(r.pt1.toByteArray())))
    assertEquals(r.pt2, String(s.decrypt(b64(r.ct2))))
    assertEquals(r.ct3, ArgusBase64.encode(s.encrypt("third".toByteArray())))
  }

  @Test fun wrongPinnedKeyFails() {
    val r = v.ik
    val wrong = NoiseCrypto.publicKey(ByteArray(32) { 7 })
    val hs = NoiseHandshake(NoiseHandshakeConfig(NoiseRole.Initiator, kp(r.iStaticPriv), wrong, ephemeral = kp(r.iEphPriv)))
    hs.writeMessage(ByteArray(0))
    val e = assertFailsWith<NoiseException> { hs.readMessage(b64(r.msg1)) }
    assertEquals(NoiseException.Reason.DecryptionFailed, e.reason)
  }

  @Test fun selfRoundTrip() {
    val i = NoiseCrypto.generateKeypair()
    val r = NoiseCrypto.generateKeypair()
    val ini = NoiseHandshake(NoiseHandshakeConfig(NoiseRole.Initiator, i, r.pub))
    val res = NoiseHandshake(NoiseHandshakeConfig(NoiseRole.Responder, r))
    res.readMessage(ini.writeMessage(ByteArray(0)))
    ini.readMessage(res.writeMessage(ByteArray(0)))
    val a = ini.session()
    val b = res.session()
    assertEquals("round trip", String(b.decrypt(a.encrypt("round trip".toByteArray()))))
    assertEquals("round trip", String(a.decrypt(b.encrypt("round trip".toByteArray()))))
    assertTrue(ini.handshakeHash().contentEquals(res.handshakeHash()))
  }
}
