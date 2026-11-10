import ArgusKit
import Foundation

/// The phone's backend with its saved answers behind it: reads that succeed
/// are kept, and reads the connection can't carry — down, dropped, or never
/// made since launch — are answered from what was kept. Everything that acts
/// goes to the live connection only and fails as it always did.
public final class SavingBackend: HostBackend {
  public let live: (any HostBackend)?
  public let saved: SavedAnswers
  /// An answer came from disk rather than the computer; when it was saved.
  private let servedSaved: @Sendable (Date) -> Void

  public init(
    live: (any HostBackend)?, saved: SavedAnswers, servedSaved: @escaping @Sendable (Date) -> Void = { _ in }
  ) {
    self.live = live
    self.saved = saved
    self.servedSaved = servedSaved
  }

  public var kind: HostBackendKind { live?.kind ?? .gateway }

  public func events() async -> AsyncStream<HostEvent> {
    if let live { return await live.events() }
    return AsyncStream { $0.finish() }
  }

  @discardableResult
  public func request<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    _ method: RemoteMethod, _ params: Params, as: Result.Type
  ) async throws -> Result {
    guard SavedAnswers.methods.contains(method.rawValue) else {
      guard let live else { throw Transport.TransportError.notReady }
      return try await live.request(method, params, as: Result.self)
    }
    let key = SavedAnswers.key(method.rawValue, params)
    let json = try await read(key) { live in try await live.request(method, params, as: JSONValue.self) }
    return try ProtocolCodec.convert(json, to: Result.self)
  }

  @discardableResult
  public func request<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async throws -> C.Result {
    guard SavedAnswers.methods.contains(C.name) else {
      guard let live else { throw Transport.TransportError.notReady }
      return try await live.request(command, params)
    }
    let key = SavedAnswers.key(C.name, params)
    do {
      guard let live else { throw Transport.TransportError.notReady }
      let result = try await live.request(command, params)
      if let json = Self.json(result) { saved.save(json, key: key) }
      return result
    } catch {
      return try ProtocolCodec.convert(try fallback(key, error), to: C.Result.self)
    }
  }

  public func sequencedRequest<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async throws
    -> (result: C.Result, seq: Int)
  {
    guard let live else { return (try await request(command, params), Int.min) }
    return try await live.sequencedRequest(command, params)
  }

  public func sequencedRequest<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    _ method: RemoteMethod, _ params: Params, as: Result.Type
  ) async throws -> (result: Result, seq: Int) {
    guard SavedAnswers.methods.contains(method.rawValue) else {
      guard let live else { throw Transport.TransportError.notReady }
      return try await live.sequencedRequest(method, params, as: Result.self)
    }
    let key = SavedAnswers.key(method.rawValue, params)
    do {
      guard let live else { throw Transport.TransportError.notReady }
      let (json, seq) = try await live.sequencedRequest(method, params, as: JSONValue.self)
      saved.save(json, key: key)
      return (try ProtocolCodec.convert(json, to: Result.self), seq)
    } catch {
      return (try ProtocolCodec.convert(try fallback(key, error), to: Result.self), Int.min)
    }
  }

  public func subscribe(agentId: String, on: Bool) async {
    await live?.subscribe(agentId: agentId, on: on)
  }

  public func disconnect() async {
    await live?.disconnect()
  }

  // MARK: Reads

  private func read(_ key: String, _ fetch: (any HostBackend) async throws -> JSONValue) async throws -> JSONValue {
    do {
      guard let live else { throw Transport.TransportError.notReady }
      let json = try await fetch(live)
      saved.save(json, key: key)
      return json
    } catch {
      return try fallback(key, error)
    }
  }

  /// Only a connection failure falls back: the computer refusing a read is an answer.
  private func fallback(_ key: String, _ error: Error) throws -> JSONValue {
    guard HostStore.isTransient(error), let answer = saved.answer(key) else { throw error }
    servedSaved(answer.savedAt)
    return answer.value
  }

  /// Generated results are Codable; one that isn't simply isn't saved.
  private static func json(_ value: some Sendable) -> JSONValue? {
    guard let encodable = value as? any Encodable, let data = try? ProtocolCodec.encoder.encode(encodable)
    else { return nil }
    return try? ProtocolCodec.decoder.decode(JSONValue.self, from: data)
  }
}
