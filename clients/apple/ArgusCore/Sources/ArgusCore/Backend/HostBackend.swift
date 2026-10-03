import Foundation

/// What the shared stores talk to: one host, over whichever channel reaches it.
///
/// `GatewayBackend` is the phone's Noise/WebSocket link to a paired computer;
/// `LocalBackend` is the Mac app's Unix socket to the host it supervises. Both
/// carry the gateway's envelopes, so the stores are written once against this.
public protocol HostBackend: AnyObject, Sendable {
  /// Which channel this is. The stores branch on it only where the two genuinely
  /// differ — a local backend builds transcripts from live events, because no
  /// other window is publishing snapshots for it to read.
  var kind: HostBackendKind { get }

  /// The event stream for this backend's lifetime. Call once.
  func events() async -> AsyncStream<HostEvent>

  /// A typed remote method (`agents.list`, `permission.respond`, …).
  @discardableResult
  func request<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    _ method: RemoteMethod, _ params: Params, as: Result.Type
  ) async throws -> Result

  /// A generated catalog command; admin-tier ones need an admin or local backend.
  @discardableResult
  func request<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async throws -> C.Result

  /// A command plus where its response falls among this backend's events: an
  /// event with a lower `seq` was sent before it. Lets a snapshot be stitched
  /// onto the live events that follow it.
  func sequencedRequest<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async throws
    -> (result: C.Result, seq: Int)

  /// Gate `agent.*` / `permission.*` events for one agent.
  func subscribe(agentId: String, on: Bool) async

  func disconnect() async
}

extension HostBackend {
  /// A channel without a shared sequence can't place its response, so every
  /// event counts as arriving after it.
  public func sequencedRequest<C: RemoteCommand>(_ command: C.Type, _ params: C.Params)
    async throws -> (result: C.Result, seq: Int)
  {
    (try await request(command, params), Int.min)
  }
}

public enum HostBackendKind: String, Sendable {
  case gateway
  case local
}

public enum HostEvent: Sendable {
  case state(Transport.State)
  /// A typed gateway event (`agent.status`, `sessions.changed`, …).
  case event(EventEnvelope)
  /// A binary device-screen frame, after the media tag byte.
  case media(Data)
}
