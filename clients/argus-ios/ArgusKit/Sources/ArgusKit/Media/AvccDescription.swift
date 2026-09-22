import Foundation

/// The avcC record that prefixes an H.264 stream: the SPS/PPS parameter sets
/// and the length prefix size its access units use.
///
/// Parameter-set lengths here are **big-endian** — that is the ISO format,
/// unlike the little-endian transport header that carries them.
public enum AvccDescription {
  public struct Parsed: Sendable, Equatable {
    public var nalUnitLengthSize: Int
    public var parameterSets: [[UInt8]]
  }

  /// Layout: `[version=1][profile][compat][level][0b111111xx nalLen-1]`
  /// `[0b111xxxxx spsCount]` then each SPS, then `[ppsCount]` then each PPS.
  public static func parse(_ data: Data) -> Parsed? {
    let bytes = [UInt8](data)
    guard bytes.count > 6, bytes[0] == 1 else { return nil }

    let nalUnitLengthSize = Int(bytes[4] & 0x03) + 1
    var offset = 5
    var sets: [[UInt8]] = []

    func readSets(count: Int) -> Bool {
      for _ in 0..<count {
        guard offset + 2 <= bytes.count else { return false }
        let length = Int(bytes[offset]) << 8 | Int(bytes[offset + 1])
        offset += 2
        guard offset + length <= bytes.count else { return false }
        sets.append(Array(bytes[offset..<(offset + length)]))
        offset += length
      }
      return true
    }

    guard offset < bytes.count else { return nil }
    let spsCount = Int(bytes[offset] & 0x1F)
    offset += 1
    guard readSets(count: spsCount) else { return nil }

    guard offset < bytes.count else { return nil }
    let ppsCount = Int(bytes[offset])
    offset += 1
    guard readSets(count: ppsCount) else { return nil }

    guard !sets.isEmpty else { return nil }
    return Parsed(nalUnitLengthSize: nalUnitLengthSize, parameterSets: sets)
  }
}
