import Foundation

/// Port forwarding: one tunnel per TCP connection accepted on this machine,
/// piped to `localhost:<port>` on the host. Admin connections only.
///
/// Frame body after the `0x03` tag: `u8 type, u8 flags, u16 id (LE), bytes`.
extension Transport {
  static let tunnelData: UInt8 = 0
  static let tunnelClose: UInt8 = 1
  /// Keeps each sealed frame well under the gateway's payload cap.
  static let tunnelChunk = 256 * 1024

  /// Connects to `port` on the host; the stream ends when the host side closes.
  public func openTunnel(sessionId: String, port: Int) async throws -> (
    id: UInt16, incoming: AsyncStream<Data>
  ) {
    struct Params: Encodable {
      let tunnelId: UInt16
      let sessionId: String
      let port: Int
      enum CodingKeys: String, CodingKey {
        case tunnelId = "tunnel_id", sessionId = "session_id", port
      }
    }
    let id = try allocTunnel()
    // Registered before asking, so bytes right behind the answer have a home.
    let (incoming, continuation) = AsyncStream<Data>.makeStream()
    tunnels[id] = continuation
    do {
      try await request(
        name: "tunnel.open", Params(tunnelId: id, sessionId: sessionId, port: port),
        as: IgnoredResult.self)
    } catch {
      tunnels.removeValue(forKey: id)?.finish()
      throw error
    }
    return (id, incoming)
  }

  public func sendTunnel(_ id: UInt16, _ data: Data) {
    guard tunnels[id] != nil else { return }
    var offset = data.startIndex
    while offset < data.endIndex {
      let end = min(offset + Self.tunnelChunk, data.endIndex)
      emit(Self.tunnelFrame(Self.tunnelData, id, data[offset..<end]), tag: Self.tagTunnel)
      offset = end
    }
  }

  /// Nothing more to send; the host's reply can still arrive.
  public func finishTunnel(_ id: UInt16) {
    guard tunnels[id] != nil else { return }
    emit(Self.tunnelFrame(Self.tunnelClose, id, Data()), tag: Self.tagTunnel)
  }

  /// The local connection is gone: drop the host's side too.
  public func closeTunnel(_ id: UInt16) async {
    guard let continuation = tunnels.removeValue(forKey: id) else { return }
    continuation.finish()
    struct Params: Encodable {
      let tunnelId: UInt16
      enum CodingKeys: String, CodingKey { case tunnelId = "tunnel_id" }
    }
    _ = try? await request(name: "tunnel.close", Params(tunnelId: id), as: IgnoredResult.self)
  }

  func receiveTunnel(_ body: Data) {
    guard body.count >= 4 else { return }
    let start = body.startIndex
    let type = body[start]
    let id = UInt16(body[start + 2]) | (UInt16(body[start + 3]) << 8)
    if type == Self.tunnelData {
      tunnels[id]?.yield(Data(body.dropFirst(4)))
    } else if type == Self.tunnelClose {
      tunnels.removeValue(forKey: id)?.finish()
    }
  }

  private func allocTunnel() throws -> UInt16 {
    for _ in 0..<UInt16.max {
      let id = nextTunnel
      nextTunnel = nextTunnel == .max ? 1 : nextTunnel + 1
      if tunnels[id] == nil { return id }
    }
    throw TransportError.notReady
  }

  static func tunnelFrame(_ type: UInt8, _ id: UInt16, _ bytes: Data) -> Data {
    var frame = Data([type, 0, UInt8(id & 0xFF), UInt8(id >> 8)])
    frame.append(bytes)
    return frame
  }
}
