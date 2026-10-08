import ArgusKit
import Foundation
import Observation

/// One worktree search at a time for one session: starting a new query cancels the
/// last, and matches stream in grouped by file in the order the host found them.
@MainActor
@Observable
public final class FileSearchStore {
  public typealias Match = ArgusProtocol.CodeSearchMatch

  public struct Group: Identifiable, Sendable {
    public let path: String
    public var matches: [Match]
    public var id: String { path }
  }

  public enum Phase: Equatable, Sendable {
    case idle
    case running
    case done(count: Int, truncated: Bool)
    case failed(String)
  }

  public private(set) var groups: [Group] = []
  public private(set) var phase: Phase = .idle
  public private(set) var matchCount = 0

  /// Called once per search that finished on its own (not cancelled).
  @ObservationIgnored public var onFinished: ((FileSearchQuery, Int, Bool) -> Void)?

  @ObservationIgnored private let host: HostStore
  @ObservationIgnored private let sessionId: String
  @ObservationIgnored private var searchId: String?
  @ObservationIgnored private var query: FileSearchQuery?
  @ObservationIgnored private var groupIndex: [String: Int] = [:]

  /// Matches past this stop the search; a phone list has no use for more.
  public static let maxResults = 2000

  public init(host: HostStore, sessionId: String) {
    self.host = host
    self.sessionId = sessionId
  }

  /// Cancel whatever is running and start `query`; an empty query just clears.
  public func run(_ query: FileSearchQuery) async {
    await cancel()
    reset()
    guard !query.text.isEmpty else { return }
    let id = "ios-\(UUID().uuidString)"
    var query = query
    query.maxResults = query.maxResults ?? Self.maxResults
    searchId = id
    self.query = query
    phase = .running
    do {
      try await host.startFileSearch(sessionId: sessionId, searchId: id, query: query) {
        [weak self] event in self?.receive(event, searchId: id)
      }
    } catch {
      guard searchId == id else { return }
      searchId = nil
      phase = .failed(HostStore.describe(error))
    }
  }

  /// Stop the running search, if any, keeping what has arrived.
  public func cancel() async {
    guard let id = searchId else { return }
    searchId = nil
    if phase == .running { phase = .done(count: matchCount, truncated: false) }
    await host.cancelFileSearch(sessionId: sessionId, searchId: id)
  }

  public func reset() {
    groups = []
    groupIndex = [:]
    matchCount = 0
    phase = .idle
  }

  func receive(_ event: ArgusProtocol.CodeSearchEvent, searchId id: String) {
    guard id == searchId else { return }
    switch event {
    case .matches(let batch):
      append(batch.matches)
    case .done(let done):
      searchId = nil
      host.endFileSearch(searchId: id)
      if let error = done.error {
        phase = .failed(error)
      } else {
        phase = .done(count: max(done.count, matchCount), truncated: done.truncated)
        if !done.cancelled, let query { onFinished?(query, matchCount, done.truncated) }
      }
    case .unknown:
      break
    }
  }

  func append(_ matches: [Match]) {
    for match in matches {
      if let index = groupIndex[match.relativePath] {
        groups[index].matches.append(match)
      } else {
        groupIndex[match.relativePath] = groups.count
        groups.append(Group(path: match.relativePath, matches: [match]))
      }
    }
    matchCount += matches.count
  }
}
