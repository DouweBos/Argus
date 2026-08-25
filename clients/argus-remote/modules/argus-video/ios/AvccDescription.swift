import CoreMedia
import Foundation

/// Parsed `avcC` record: the parameter sets plus the NAL length prefix size the
/// stream uses. The gateway sends WebCodecs-style descriptions, so samples are
/// length-prefixed rather than Annex-B.
struct AvccDescription {
  let parameterSets: [[UInt8]]
  let nalUnitLengthSize: Int

  init?(_ bytes: [UInt8]) {
    guard bytes.count > 6, bytes[0] == 1 else {
      return nil
    }
    nalUnitLengthSize = Int(bytes[4] & 0x03) + 1

    var sets: [[UInt8]] = []
    var offset = 5

    guard offset < bytes.count else {
      return nil
    }
    let spsCount = Int(bytes[offset] & 0x1F)
    offset += 1
    for _ in 0..<spsCount {
      guard offset + 2 <= bytes.count else {
        return nil
      }
      let length = Int(bytes[offset]) << 8 | Int(bytes[offset + 1])
      offset += 2
      guard offset + length <= bytes.count else {
        return nil
      }
      sets.append(Array(bytes[offset..<(offset + length)]))
      offset += length
    }

    guard offset < bytes.count else {
      return nil
    }
    let ppsCount = Int(bytes[offset])
    offset += 1
    for _ in 0..<ppsCount {
      guard offset + 2 <= bytes.count else {
        return nil
      }
      let length = Int(bytes[offset]) << 8 | Int(bytes[offset + 1])
      offset += 2
      guard offset + length <= bytes.count else {
        return nil
      }
      sets.append(Array(bytes[offset..<(offset + length)]))
      offset += length
    }

    guard sets.count >= 2 else {
      return nil
    }
    parameterSets = sets
  }

  /// Build the format description VideoToolbox needs for these parameter sets.
  func formatDescription() -> CMFormatDescription? {
    var pointers: [UnsafePointer<UInt8>] = []
    var sizes: [Int] = []
    var buffers: [UnsafeMutablePointer<UInt8>] = []
    defer { buffers.forEach { $0.deallocate() } }

    for set in parameterSets {
      let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: set.count)
      buffer.update(from: set, count: set.count)
      buffers.append(buffer)
      pointers.append(UnsafePointer(buffer))
      sizes.append(set.count)
    }

    var format: CMFormatDescription?
    let status = CMVideoFormatDescriptionCreateFromH264ParameterSets(
      allocator: kCFAllocatorDefault,
      parameterSetCount: pointers.count,
      parameterSetPointers: &pointers,
      parameterSetSizes: &sizes,
      nalUnitHeaderLength: Int32(nalUnitLengthSize),
      formatDescriptionOut: &format
    )

    return status == noErr ? format : nil
  }
}
