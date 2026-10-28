import Foundation

/// Picks which of a computer's addresses to talk over.
///
/// A desktop can be reachable several ways at once — the LAN, its tailnet
/// address, its account's Cloudflare tunnel — and which ones work depends on
/// where the phone is. Rather than making the user choose, every candidate is dialled at once
/// and the simplest one that completes the pinned-key Noise handshake wins.
///
/// The handshake, not just a socket open, is the test on purpose: a stale LAN
/// IP can be answered by a different machine, and a captive portal will happily
/// accept a connection to anything. Only the real desktop holds the pinned key.
public enum EndpointRacer {
  /// How long to keep waiting for a better-ranked endpoint once a worse-ranked
  /// one is already up. Cloudflare usually answers before a cold Tailscale
  /// dial, and switching later would drop the connection.
  static let grace: Duration = .milliseconds(1200)
  /// Give up on a candidate that never handshakes (blackholed IP, dead tunnel).
  static let probeTimeout: Duration = .seconds(8)

  public struct Attempt: Sendable {
    public let transport: Transport
    /// The address that won, with its rank.
    public let endpoint: RemoteEndpoint
    public var url: String { endpoint.url }
  }

  public enum RaceError: Error, Equatable {
    case noKnownAddress
    case unreachable
  }

  private enum Outcome: Sendable {
    case ready(Int)
    case failed(Int)
    case graceExpired
  }

  public static func connectBest(identity: DeviceIdentity) async throws -> Attempt {
    let candidates = identity.candidateEndpoints
    guard !candidates.isEmpty else { throw RaceError.noKnownAddress }
    guard let attempt = await race(identity: identity, candidates: candidates) else {
      throw RaceError.unreachable
    }
    return attempt
  }

  /// Preflight a route change: race only `candidates` (a full handshake each,
  /// so a winner both works and still authorizes this device) and hand back
  /// the best one, leaving whatever connection is live untouched. Nil when
  /// none of them answered.
  public static func preflight(identity: DeviceIdentity, candidates: [RemoteEndpoint]) async -> Attempt? {
    guard !candidates.isEmpty else { return nil }
    return await race(identity: identity, candidates: candidates.sorted { $0.priority < $1.priority })
  }

  private static func race(identity: DeviceIdentity, candidates: [RemoteEndpoint]) async -> Attempt? {
    let transports = candidates.map { Transport(identity: identity, url: $0.url) }

    // The group never throws — it reports a winner or nothing, so the cleanup
    // below always runs.
    let attempt: Attempt? = await withTaskGroup(of: Outcome.self) { group in
      for (index, transport) in transports.enumerated() {
        group.addTask {
          await probe(transport, index: index)
        }
      }

      var best: Int?
      var finished = Set<Int>()
      var graceArmed = false

      /// True when nothing still in flight could beat what we already have.
      func noBetterPossible() -> Bool {
        guard let best else { return false }
        return !candidates.indices.contains { i in
          candidates[i].priority < candidates[best].priority && !finished.contains(i)
        }
      }

      loop: while let outcome = await group.next() {
        switch outcome {
        case .ready(let index):
          finished.insert(index)
          if let current = best {
            // Keep whichever is simpler; drop the other immediately.
            if candidates[index].priority < candidates[current].priority {
              await transports[current].disconnect()
              best = index
            } else {
              await transports[index].disconnect()
            }
          } else {
            best = index
          }
          if candidates[best!].priority == 0 || noBetterPossible() { break loop }
          if !graceArmed {
            graceArmed = true
            group.addTask {
              try? await Task.sleep(for: grace)
              return .graceExpired
            }
          }

        case .failed(let index):
          finished.insert(index)
          await transports[index].disconnect()
          // A better-ranked candidate just died, so stop holding the winner back.
          if best != nil, noBetterPossible() { break loop }
          if best == nil, finished.count == candidates.count { break loop }

        case .graceExpired:
          if best != nil { break loop }
        }
      }

      group.cancelAll()

      guard let winner = best else {
        for transport in transports { await transport.disconnect() }
        return nil
      }
      for (index, transport) in transports.enumerated() where index != winner {
        await transport.disconnect()
      }
      return Attempt(transport: transports[winner], endpoint: candidates[winner])
    }
    return attempt
  }

  /// Resolve once this candidate either completes a handshake or gives up.
  private static func probe(_ transport: Transport, index: Int) async -> Outcome {
    let stream = await transport.start()
    let deadline = Task {
      try? await Task.sleep(for: probeTimeout)
      return Outcome.failed(index)
    }
    defer { deadline.cancel() }

    return await withTaskGroup(of: Outcome.self) { group in
      group.addTask {
        for await event in stream {
          if case .state(let state) = event {
            if state == .ready { return .ready(index) }
            // The socket reconnects on its own, but a probe that has already
            // dropped once is not the address we want to settle on.
            if state == .offline { return .failed(index) }
          }
        }
        return .failed(index)
      }
      group.addTask { await deadline.value }
      let first = await group.next() ?? .failed(index)
      group.cancelAll()
      return first
    }
  }
}
