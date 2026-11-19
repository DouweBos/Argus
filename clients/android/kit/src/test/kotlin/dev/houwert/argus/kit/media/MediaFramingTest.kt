package dev.houwert.argus.kit.media

import dev.houwert.argus.kit.crypto.ArgusBase64
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Test

/** Frames built by the host's own `buildConfigBody` / `buildFrameBody`; little-endian throughout. */
class MediaFramingTest {
  private val configFrame = "AAABEAAAAAAAAAAAkgTkCQthdmMxLjY0MDAyOAFkACj/4QAFZ2QAKAEBAARo7jyw"
  private val configDescription = "AWQAKP/hAAVnZAAoAQEABGjuPLA="
  private val keyFrame = "AQEBEK36XG1FSpNAAAAABWUBAgME"
  private val deltaFrame = "AQD//wAAAOiH1mJBAAAAAkEJ"

  @Test fun parsesAConfigMessage() {
    val parsed = assertIs<MediaMessage.Config>(MediaMessage.parse(ArgusBase64.decode(configFrame)!!))
    assertEquals(4097, parsed.streamId)
    assertEquals("avc1.640028", parsed.codec)
    assertEquals(1170, parsed.codedWidth)
    assertEquals(2532, parsed.codedHeight)
    assertEquals(configDescription, ArgusBase64.encode(parsed.description))
  }

  @Test fun parsesAKeyFrameWithItsLittleEndianTimestamp() {
    val parsed = assertIs<MediaMessage.Frame>(MediaMessage.parse(ArgusBase64.decode(keyFrame)!!))
    assertEquals(4097, parsed.streamId)
    assertTrue(parsed.keyFrame)
    assertTrue(abs(parsed.timestamp - 1234.5678) < 0.0001)
    assertContentEquals(byteArrayOf(0, 0, 0, 5, 101, 1, 2, 3, 4), parsed.data)
  }

  @Test fun parsesADeltaFrameAtTheTopOfTheStreamIdRange() {
    val parsed = assertIs<MediaMessage.Frame>(MediaMessage.parse(ArgusBase64.decode(deltaFrame)!!))
    // Stream ids wrap at 0xffff, so the boundary value has to survive.
    assertEquals(65535, parsed.streamId)
    assertFalse(parsed.keyFrame)
    assertTrue(abs(parsed.timestamp - 9_876_543.25) < 0.0001)
    assertContentEquals(byteArrayOf(0, 0, 0, 2, 65, 9), parsed.data)
  }

  @Test fun rejectsTruncatedAndUnmodelledMessages() {
    assertNull(MediaMessage.parse(byteArrayOf(0, 0, 0, 0)))
    assertNull(MediaMessage.parse(byteArrayOf()))
    val unknown = ByteArray(16).also { it[0] = 9 }
    assertNull(MediaMessage.parse(unknown))
  }

  @Test fun parsesABrowserJpegFrame() {
    val bytes = ByteBuffer.allocate(15).order(ByteOrder.LITTLE_ENDIAN)
      .put(byteArrayOf(2, 0, 7, 0)).putDouble(1234.5).put(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte())).array()
    val parsed = assertIs<MediaMessage.Jpeg>(MediaMessage.parse(bytes))
    assertEquals(7, parsed.streamId)
    assertEquals(1234.5, parsed.timestamp)
    assertContentEquals(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte()), parsed.data)
  }
}

/** The avcC record MediaCodec is configured from; its lengths are big-endian, unlike the header. */
class AvccDescriptionTest {
  private val description = "AWQAKP/hAAVnZAAoAQEABGjuPLA="

  @Test fun parsesParameterSetsAndTheNalLengthSize() {
    val parsed = assertNotNull(AvccDescription.parse(ArgusBase64.decode(description)!!))
    assertEquals(4, parsed.nalUnitLengthSize)
    assertEquals(2, parsed.parameterSets.size)
    assertContentEquals(byteArrayOf(0x67, 0x64, 0x00, 0x28, 0x01), parsed.parameterSets[0])
    assertContentEquals(byteArrayOf(0x68, 0xEE.toByte(), 0x3C, 0xB0.toByte()), parsed.parameterSets[1])
    assertContentEquals(byteArrayOf(0, 0, 0, 1, 0x67, 0x64, 0x00, 0x28, 0x01), parsed.annexB(0))
  }

  @Test fun rejectsARecordItCantTrust() {
    assertNull(AvccDescription.parse(byteArrayOf()))
    assertNull(AvccDescription.parse(byteArrayOf(2, 0, 0, 0, 0xFF.toByte(), 0xE1.toByte(), 0, 0)))
    assertNull(AvccDescription.parse(byteArrayOf(1, 0x64, 0, 0x28, 0xFF.toByte(), 0xE1.toByte(), 0, 0x05, 0x67)))
  }

  @Test fun rewritesLengthPrefixedUnitsToAnnexB() {
    val frame = byteArrayOf(0, 0, 0, 2, 65, 9, 0, 0, 0, 1, 7)
    assertContentEquals(byteArrayOf(0, 0, 0, 1, 65, 9, 0, 0, 0, 1, 7), AvccDescription.toAnnexB(frame, 4))
    assertContentEquals(byteArrayOf(0, 0, 0, 1, 65, 9), AvccDescription.toAnnexB(byteArrayOf(0, 2, 65, 9), 2))
    assertNull(AvccDescription.toAnnexB(byteArrayOf(0, 0, 0, 9, 1), 4))
  }
}
