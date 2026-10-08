import ArgusKit
import Foundation

/// Read-only file access for a session: one file's contents, and a streamed
/// worktree search. Both are control-tier on the gateway.
extension HostStore {
  /// Throws so the viewer can tell "not in this session" from a dropped link.
  public func readFile(sessionId: String, path: String) async throws -> ArgusProtocol.CodeFile {
    guard let backend else { throw Self.offlineError }
    return try await backend.request(
      ArgusProtocol.Methods.FilesRead.self, .init(sessionId: sessionId, path: path))
  }

  /// Start a search whose events go to `deliver` until it is done or `endFileSearch`.
  /// The subscription is opened before the call, so no early batch is lost.
  public func startFileSearch(
    sessionId: String, searchId: String, query: FileSearchQuery,
    deliver: @escaping @MainActor (ArgusProtocol.CodeSearchEvent) -> Void
  ) async throws {
    guard let backend else { throw Self.offlineError }
    fileSearchObservers[searchId] = deliver
    await backend.subscribe(agentId: Self.searchScope(searchId), on: true)
    do {
      _ = try await backend.request(
        ArgusProtocol.Methods.FilesSearch.self,
        .init(
          sessionId: sessionId, searchId: searchId, query: query.text, regex: query.regex,
          caseSensitive: query.caseSensitive, wholeWord: query.wholeWord,
          maxResults: query.maxResults))
    } catch {
      endFileSearch(searchId: searchId)
      throw error
    }
  }

  /// Ask the host to stop a running search, then stop listening for it.
  public func cancelFileSearch(sessionId: String, searchId: String) async {
    endFileSearch(searchId: searchId)
    guard let backend else { return }
    _ = try? await backend.request(
      ArgusProtocol.Methods.FilesSearchCancel.self,
      .init(sessionId: sessionId, searchId: searchId))
  }

  /// Drop the listener and the subscription; the search itself is left alone.
  public func endFileSearch(searchId: String) {
    guard fileSearchObservers.removeValue(forKey: searchId) != nil else { return }
    let scope = Self.searchScope(searchId)
    Task { [backend] in await backend?.subscribe(agentId: scope, on: false) }
  }

  nonisolated static var offlineError: GatewayErrorPayload {
    GatewayErrorPayload(code: "offline", message: "Not connected to the computer.")
  }

  nonisolated static func searchScope(_ searchId: String) -> String { "code-search:\(searchId)" }
}

public struct FileSearchQuery: Equatable, Sendable {
  public var text: String
  public var regex: Bool
  public var caseSensitive: Bool
  public var wholeWord: Bool
  public var maxResults: Int?

  public init(
    text: String, regex: Bool = false, caseSensitive: Bool = false, wholeWord: Bool = false,
    maxResults: Int? = nil
  ) {
    self.text = text
    self.regex = regex
    self.caseSensitive = caseSensitive
    self.wholeWord = wholeWord
    self.maxResults = maxResults
  }
}
