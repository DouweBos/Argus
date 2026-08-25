package dev.houwert.argus.video

/**
 * Parsed `avcC` record. The gateway sends WebCodecs-style descriptions, so
 * parameter sets live here and samples are length-prefixed rather than Annex-B.
 */
data class AvccDescription(
  val parameterSets: List<ByteArray>,
  val nalUnitLengthSize: Int,
) {
  companion object {
    private const val START_CODE_SIZE = 4

    fun parse(bytes: ByteArray): AvccDescription? {
      if (bytes.size <= 6 || bytes[0].toInt() != 1) {
        return null
      }
      val lengthSize = (bytes[4].toInt() and 0x03) + 1
      val sets = mutableListOf<ByteArray>()
      var offset = 5

      fun readSets(count: Int): Boolean {
        repeat(count) {
          if (offset + 2 > bytes.size) {
            return false
          }
          val length = ((bytes[offset].toInt() and 0xFF) shl 8) or
            (bytes[offset + 1].toInt() and 0xFF)
          offset += 2
          if (offset + length > bytes.size) {
            return false
          }
          sets.add(bytes.copyOfRange(offset, offset + length))
          offset += length
        }

        return true
      }

      val spsCount = bytes[offset].toInt() and 0x1F
      offset += 1
      if (!readSets(spsCount)) {
        return null
      }
      if (offset >= bytes.size) {
        return null
      }
      val ppsCount = bytes[offset].toInt() and 0xFF
      offset += 1
      if (!readSets(ppsCount)) {
        return null
      }
      if (sets.size < 2) {
        return null
      }

      return AvccDescription(sets, lengthSize)
    }

    /** Prefix a parameter set with an Annex-B start code for `csd-*`. */
    fun withStartCode(set: ByteArray): ByteArray {
      val out = ByteArray(START_CODE_SIZE + set.size)
      out[3] = 1
      set.copyInto(out, START_CODE_SIZE)

      return out
    }
  }

  /**
   * Rewrite a length-prefixed access unit to Annex-B, which is what MediaCodec
   * expects once it's configured from parameter sets.
   */
  fun toAnnexB(sample: ByteArray): ByteArray {
    val out = java.io.ByteArrayOutputStream(sample.size + 16)
    var offset = 0
    while (offset + nalUnitLengthSize <= sample.size) {
      var length = 0
      for (i in 0 until nalUnitLengthSize) {
        length = (length shl 8) or (sample[offset + i].toInt() and 0xFF)
      }
      val payloadStart = offset + nalUnitLengthSize
      if (length <= 0 || payloadStart + length > sample.size) {
        break
      }
      out.write(byteArrayOf(0, 0, 0, 1))
      out.write(sample, payloadStart, length)
      offset = payloadStart + length
    }

    return out.toByteArray()
  }
}
