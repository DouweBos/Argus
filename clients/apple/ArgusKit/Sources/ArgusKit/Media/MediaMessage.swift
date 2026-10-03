import Foundation

/// Binary media framing shared with the desktop gateway.
///
/// Device video is raw H.264 (an avcC description plus access units); the
/// embedded browser sends standalone JPEGs. Decoding happens in the views, so
/// this layer only parses the envelope.
/// Every multi-byte field is little-endian, including the timestamp — the
/// parameter-set lengths *inside* the avcC description are big-endian, but
/// that is ISO format and not our concern here.
public enum MediaMessage: Sendable {
  case config(
    streamId: UInt16, codec: String, codedWidth: Int, codedHeight: Int, description: Data)
  case frame(streamId: UInt16, keyFrame: Bool, timestamp: Double, data: Data)
  /// One browser screencast frame; each stands alone.
  case jpeg(streamId: UInt16, timestamp: Double, data: Data)

  public var streamId: UInt16 {
    switch self {
    case .config(let id, _, _, _, _): id
    case .frame(let id, _, _, _): id
    case .jpeg(let id, _, _): id
    }
  }

  /// Parse a media message — the bytes after the transport's media tag.
  public static func parse(_ bytes: Data) -> MediaMessage? {
    guard bytes.count >= 12 else { return nil }
    let b = [UInt8](bytes)

    func u16(_ offset: Int) -> UInt16 {
      UInt16(b[offset]) | (UInt16(b[offset + 1]) << 8)
    }

    let msgType = b[0]
    let flags = b[1]
    let streamId = u16(2)

    var rawTimestamp: UInt64 = 0
    for i in 0..<8 {
      rawTimestamp |= UInt64(b[4 + i]) << (8 * UInt64(i))
    }
    let timestamp = Double(bitPattern: rawTimestamp)

    if msgType == 0 {
      // config: [codedW u16][codedH u16][codecLen u8][codec][description]
      guard bytes.count >= 17 else { return nil }
      let codecLen = Int(b[16])
      guard bytes.count >= 17 + codecLen else { return nil }
      let codec = String(decoding: b[17..<(17 + codecLen)], as: UTF8.self)
      return .config(
        streamId: streamId,
        codec: codec,
        codedWidth: Int(u16(12)),
        codedHeight: Int(u16(14)),
        description: Data(b[(17 + codecLen)...])
      )
    }

    if msgType == 2 {
      return .jpeg(streamId: streamId, timestamp: timestamp, data: Data(b[12...]))
    }

    guard msgType == 1 else { return nil }
    return .frame(
      streamId: streamId,
      keyFrame: (flags & 1) == 1,
      timestamp: timestamp,
      data: Data(b[12...])
    )
  }
}
