import ArgusKit
import Foundation
import Observation

/// How a search reaches the host. The phone goes through the gateway's `files.search`
/// (`HostStore`); the Mac uses the `code_search` command, which also takes globs.
@MainActor
public protocol FileSearchTransport: AnyObject {
  /// Start a search whose events go to `deliver` until it is done or `endFileSearch`.
  func startFileSearch(
    sessionId: String, searchId: String, query: FileSearchQuery,
    deliver: @escaping @MainActor (ArgusProtocol.CodeSearchEvent) -> Void
  ) async throws
  /// Ask the host to stop a running search, then stop listening for it.
  func cancelFileSearch(sessionId: String, searchId: String) async
  /// Drop the listener; the search itself is left alone.
  func endFileSearch(searchId: String)
}

extension HostStore: FileSearchTransport {}

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

  public var isRunning: Bool { phase == .running }
  public var truncated: Bool { if case .done(_, true) = phase { true } else { false } }
  public var error: String? { if case .failed(let message) = phase { message } else { nil } }

  /// Called once per search that finished on its own (not cancelled).
  @ObservationIgnored public var onFinished: ((FileSearchQuery, Int, Bool) -> Void)?
  /// How long `schedule` waits for typing to settle.
  @ObservationIgnored public var debounce: Duration = .milliseconds(350)

  @ObservationIgnored private let transport: FileSearchTransport
  @ObservationIgnored private let sessionId: String
  @ObservationIgnored private var searchId: String?
  @ObservationIgnored private var query: FileSearchQuery?
  @ObservationIgnored private var groupIndex: [String: Int] = [:]
  @ObservationIgnored private var pending: Task<Void, Never>?
  /// The results came from `show`, not a search for `query`.
  @ObservationIgnored private var shownExternally = false

  /// Matches past this stop the search; a list has no use for more.
  public static let maxResults = 2000

  public init(transport: FileSearchTransport, sessionId: String) {
    self.transport = transport
    self.sessionId = sessionId
  }

  public convenience init(host: HostStore, sessionId: String) {
    self.init(transport: host, sessionId: sessionId)
  }

  /// Run `query` once typing settles; a newer call replaces a waiting one.
  public func schedule(_ query: FileSearchQuery) {
    pending?.cancel()
    // `show` put the query's text in the field; don't replace its results with a search.
    if shownExternally, query.text == self.query?.text { return }
    pending = Task { [debounce] in
      try? await Task.sleep(for: debounce)
      guard !Task.isCancelled else { return }
      await self.run(query)
    }
  }

  /// Cancel whatever is running and start `query`; an empty query just clears.
  public func run(_ query: FileSearchQuery) async {
    if let id = detach() { await transport.cancelFileSearch(sessionId: sessionId, searchId: id) }
    reset()
    guard !query.text.isEmpty else { return }
    let id = UUID().uuidString
    var query = query
    query.maxResults = query.maxResults ?? Self.maxResults
    searchId = id
    self.query = query
    phase = .running
    do {
      try await transport.startFileSearch(sessionId: sessionId, searchId: id, query: query) {
        [weak self] event in self?.receive(event, searchId: id)
      }
    } catch {
      guard searchId == id else { return }
      searchId = nil
      phase = .failed(HostStore.describe(error))
    }
  }

  /// Matches found elsewhere (Find References), shown as if searched for `title`.
  public func show(_ matches: [Match], title: String) {
    pending?.cancel()
    if let id = detach() {
      Task { [transport, sessionId] in await transport.cancelFileSearch(sessionId: sessionId, searchId: id) }
    }
    reset()
    query = FileSearchQuery(text: title)
    shownExternally = true
    append(matches)
    phase = .done(count: matches.count, truncated: false)
  }

  /// Stop the running search, if any, keeping what has arrived.
  public func cancel() async {
    pending?.cancel()
    guard let id = detach() else { return }
    await transport.cancelFileSearch(sessionId: sessionId, searchId: id)
  }

  public func reset() {
    groups = []
    groupIndex = [:]
    matchCount = 0
    phase = .idle
    query = nil
    shownExternally = false
  }

  private func detach() -> String? {
    guard let id = searchId else { return nil }
    searchId = nil
    if phase == .running { phase = .done(count: matchCount, truncated: false) }
    return id
  }

  func receive(_ event: ArgusProtocol.CodeSearchEvent, searchId id: String) {
    guard id == searchId else { return }
    switch event {
    case .matches(let batch):
      append(batch.matches)
    case .done(let done):
      searchId = nil
      transport.endFileSearch(searchId: id)
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
