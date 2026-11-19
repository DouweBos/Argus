package dev.houwert.argus.kit.media

/**
 * The avcC record that prefixes an H.264 stream: its SPS/PPS parameter sets and
 * NAL length prefix size. Lengths here are big-endian (ISO), unlike the transport header.
 */
object AvccDescription {
  class Parsed(val nalUnitLengthSize: Int, val parameterSets: List<ByteArray>) {
    /** Annex B start codes, as MediaCodec's `csd-0`/`csd-1` want them. */
    fun annexB(index: Int): ByteArray = START_CODE + parameterSets[index]
  }

  private val START_CODE = byteArrayOf(0, 0, 0, 1)

  /** `[1][profile][compat][level][0b111111xx nalLen-1][0b111xxxxx spsCount]` SPS... `[ppsCount]` PPS... */
  fun parse(data: ByteArray): Parsed? {
    if (data.size <= 6 || data[0].toInt() != 1) return null
    fun u8(i: Int) = data[i].toInt() and 0xFF
    val nalUnitLengthSize = (u8(4) and 0x03) + 1
    var offset = 5
    val sets = mutableListOf<ByteArray>()

    fun readSets(count: Int): Boolean {
      repeat(count) {
        if (offset + 2 > data.size) return false
        val length = (u8(offset) shl 8) or u8(offset + 1)
        offset += 2
        if (offset + length > data.size) return false
        sets += data.copyOfRange(offset, offset + length)
        offset += length
      }
      return true
    }

    if (offset >= data.size) return null
    val spsCount = u8(offset) and 0x1F
    offset += 1
    if (!readSets(spsCount)) return null
    if (offset >= data.size) return null
    val ppsCount = u8(offset)
    offset += 1
    if (!readSets(ppsCount)) return null
    if (sets.isEmpty()) return null
    return Parsed(nalUnitLengthSize, sets)
  }

  /** Rewrite length-prefixed NAL units to Annex B in place, which MediaCodec decodes. */
  fun toAnnexB(data: ByteArray, nalUnitLengthSize: Int): ByteArray? {
    if (nalUnitLengthSize != 4) return lengthPrefixedToAnnexB(data, nalUnitLengthSize)
    val out = data.copyOf()
    var offset = 0
    while (offset + 4 <= out.size) {
      var length = 0
      for (i in 0 until 4) length = (length shl 8) or (out[offset + i].toInt() and 0xFF)
      if (length < 0 || offset + 4 + length > out.size) return null
      out[offset] = 0; out[offset + 1] = 0; out[offset + 2] = 0; out[offset + 3] = 1
      offset += 4 + length
    }
    return if (offset == out.size) out else null
  }

  private fun lengthPrefixedToAnnexB(data: ByteArray, size: Int): ByteArray? {
    val out = java.io.ByteArrayOutputStream(data.size + 16)
    var offset = 0
    while (offset + size <= data.size) {
      var length = 0
      for (i in 0 until size) length = (length shl 8) or (data[offset + i].toInt() and 0xFF)
      offset += size
      if (offset + length > data.size) return null
      out.write(START_CODE)
      out.write(data, offset, length)
      offset += length
    }
    return if (offset == data.size) out.toByteArray() else null
  }
}
