import ArgusCore
import Foundation
import Observation

/// Search across the worktree (⇧⌘F): ripgrep on the host, results streamed as
/// `code:search:<searchId>` batches and grouped by file. A new query cancels the last.
@MainActor
@Observable
final class CodeSearchModel {
  struct FileResult: Identifiable {
    let path: String
    var matches: [ArgusProtocol.CodeSearchMatch]
    var id: String { path }
  }

  static let maxResults = 2000

  let sessionId: String
  @ObservationIgnored weak var session: CodeSession?
  var query = ""
  var isRegex = false
  var isCaseSensitive = false
  var isWholeWord = false
  /// Comma-separated globs.
  var include = ""
  var exclude = ""
  var showsFilters = false
  private(set) var results: [FileResult] = []
  private(set) var matchCount = 0
  private(set) var isRunning = false
  private(set) var truncated = false
  private(set) var error: String?
  /// Bumped to focus the query field.
  private(set) var focusRequest = 0
  @ObservationIgnored private(set) var searchId: String?
  @ObservationIgnored private var index: [String: Int] = [:]

  init(sessionId: String) {
    self.sessionId = sessionId
  }

  func focus() { focusRequest += 1 }

  /// Runs the query as it stands; an empty one just clears.
  func run() {
    cancel()
    results = []
    index = [:]
    matchCount = 0
    truncated = false
    error = nil
    let text = query
    guard !text.isEmpty, let store = session?.store else { return }
    let id = UUID().uuidString
    searchId = id
    isRunning = true
    let params = ArgusProtocol.CommandsTypes.CodeSearchParams(
      query: text, regex: isRegex, caseSensitive: isCaseSensitive, wholeWord: isWholeWord,
      include: Self.globs(include), exclude: Self.globs(exclude), maxResults: Self.maxResults, id: sessionId,
      searchId: id)
    Task {
      // Subscribe first: the first batch can arrive before the response.
      await store.subscribe("code-search:\(id)", session: sessionId, on: true)
      do {
        _ = try await store.request(ArgusProtocol.Commands.CodeSearch.self, params, session: sessionId)
      } catch {
        guard searchId == id else { return }
        self.error = HostStore.describe(error)
        finish()
      }
    }
  }

  /// Stops the running search, if any.
  func cancel() {
    guard let id = searchId else { return }
    let wasRunning = isRunning
    finish()
    guard wasRunning, let store = session?.store else { return }
    Task { [sessionId] in
      _ = try? await store.request(
        ArgusProtocol.Commands.CodeSearchCancel.self, .init(searchId: id), session: sessionId)
    }
  }

  func receive(_ event: ArgusProtocol.CodeSearchEvent) {
    switch event {
    case .matches(let batch) where batch.searchId == searchId:
      for match in batch.matches {
        if let position = index[match.relativePath] {
          results[position].matches.append(match)
        } else {
          index[match.relativePath] = results.count
          results.append(FileResult(path: match.relativePath, matches: [match]))
        }
      }
      matchCount += batch.matches.count
    case .done(let done) where done.searchId == searchId:
      truncated = done.truncated
      if let message = done.error { error = message }
      if !done.cancelled {
        MacTelemetry.capture(
          .editorSearchRun(
            scope: .worktree, regex: isRegex, resultBucket: MacTelemetryEvent.countBucket(done.count),
            truncated: done.truncated))
      }
      finish()
    default:
      break
    }
  }

  private func finish() {
    isRunning = false
    guard let id = searchId, let store = session?.store else { return }
    searchId = nil
    Task { [sessionId] in await store.subscribe("code-search:\(id)", session: sessionId, on: false) }
  }

  static func globs(_ text: String) -> [String]? {
    let globs = text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    return globs.isEmpty ? nil : globs
  }
}
