package dev.houwert.argus.kit.media

/**
 * Binary media framing shared with the desktop gateway: raw H.264 (an avcC
 * description plus access units) for devices, standalone JPEGs for the browser.
 * Every multi-byte field is little-endian, the Float64 timestamp included.
 */
sealed interface MediaMessage {
  val streamId: Int

  class Config(
    override val streamId: Int,
    val codec: String,
    val codedWidth: Int,
    val codedHeight: Int,
    val description: ByteArray,
  ) : MediaMessage

  class Frame(override val streamId: Int, val keyFrame: Boolean, val timestamp: Double, val data: ByteArray) : MediaMessage

  /** One browser screencast frame; each stands alone. */
  class Jpeg(override val streamId: Int, val timestamp: Double, val data: ByteArray) : MediaMessage

  companion object {
    /** Parse a media message: the bytes after the transport's media tag. */
    fun parse(bytes: ByteArray): MediaMessage? {
      if (bytes.size < 12) return null
      fun u8(offset: Int) = bytes[offset].toInt() and 0xFF
      fun u16(offset: Int) = u8(offset) or (u8(offset + 1) shl 8)

      val type = u8(0)
      val flags = u8(1)
      val streamId = u16(2)
      var raw = 0L
      for (i in 0 until 8) raw = raw or (u8(4 + i).toLong() shl (8 * i))
      val timestamp = Double.fromBits(raw)

      return when (type) {
        // config: [codedW u16][codedH u16][codecLen u8][codec][description]
        0 -> {
          if (bytes.size < 17) return null
          val codecLen = u8(16)
          if (bytes.size < 17 + codecLen) return null
          Config(
            streamId, bytes.decodeToString(17, 17 + codecLen), u16(12), u16(14),
            bytes.copyOfRange(17 + codecLen, bytes.size),
          )
        }
        1 -> Frame(streamId, flags and 1 == 1, timestamp, bytes.copyOfRange(12, bytes.size))
        2 -> Jpeg(streamId, timestamp, bytes.copyOfRange(12, bytes.size))
        else -> null
      }
    }
  }
}
