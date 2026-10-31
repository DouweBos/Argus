import ArgusKit
import Foundation

/// A message line that matched a chat search; its offsets are UTF-16, as JavaScript counts them.
public typealias ChatHistoryMatch = ArgusProtocol.MethodsTypes.AgentsHistorySearchResultResultsItemMessageMatchesItem

extension ChatHistoryMatch {
  /// The snippet around its hit, offsets clamped to the text.
  public var parts: (before: String, hit: String, after: String) {
    let text = snippet as NSString
    let start = min(max(matchStart, 0), text.length)
    let end = min(max(matchEnd, start), text.length)
    return (
      text.substring(to: start), text.substring(with: NSRange(location: start, length: end - start)),
      text.substring(from: end)
    )
  }
}

/// A project's saved chats: listed per session, searched, deleted and resumed.
/// Live agents are never here — the host leaves them to `agents.list`.
extension HostStore {
  /// A session's past chats, newest first; nil when the host couldn't be asked.
  public func chatHistory(for session: RemoteSession) async -> [RemoteStoppedAgent]? {
    guard backend != nil else { return nil }
    await loadStoppedAgents(repoRoot: session.repoRoot)
    return chats(in: session)
  }

  /// What `chatHistory(for:)` last found, without asking again.
  public func chats(in session: RemoteSession) -> [RemoteStoppedAgent]? {
    stoppedByRepo[session.repoRoot]?
      .filter { $0.branch == session.branch }
      .sorted { $0.endedAt > $1.endedAt }
  }

  public func stoppedChat(repoRoot: String, historyId: String) -> RemoteStoppedAgent? {
    stoppedByRepo[repoRoot]?.first { $0.historyId == historyId }
  }

  /// Message hits across the repo's saved chats, by history id; titles are the caller's to match.
  public func searchChatHistory(repoRoot: String, query: String) async -> [String: [ChatHistoryMatch]]? {
    let query = query.trimmingCharacters(in: .whitespaces)
    guard let backend, !query.isEmpty else { return nil }
    guard
      let result = try? await backend.request(
        .agentsHistorySearch,
        ArgusProtocol.MethodsTypes.AgentsHistorySearchParams(repoRoot: repoRoot, query: query),
        as: ArgusProtocol.MethodsTypes.AgentsHistorySearchResult.self)
    else { return nil }
    return Dictionary(
      result.results.map { ($0.historyId, $0.messageMatches) }, uniquingKeysWith: { first, _ in first })
  }

  /// The chats a search shows: titles narrow at once, the host's hits (`hits`, for `query`) once they arrive.
  public nonisolated static func filterChats(
    _ chats: [RemoteStoppedAgent], query: String, hits: (query: String, matches: [String: [ChatHistoryMatch]])?
  ) -> [RemoteStoppedAgent] {
    let needle = query.trimmingCharacters(in: .whitespaces)
    guard !needle.isEmpty else { return chats }
    guard let hits, hits.query == needle else {
      return chats.filter { $0.title.localizedCaseInsensitiveContains(needle) }
    }
    return chats.filter { hits.matches[$0.historyId] != nil }
  }

  /// Delete saved chats, then re-read the list so every view follows.
  public func deleteChatHistory(repoRoot: String, historyIds: [String]) async {
    guard let backend else { return }
    for id in historyIds {
      do {
        try await backend.request(
          .agentsHistoryDelete,
          ArgusProtocol.MethodsTypes.AgentsHistoryDeleteParams(repoRoot: repoRoot, historyId: id),
          as: ArgusProtocol.MethodsTypes.AgentsHistoryDeleteResult.self)
      } catch {
        report(error)
        break
      }
    }
    await loadStoppedAgents(repoRoot: repoRoot)
  }

  /// A new agent on the chat's Claude session and runner; the host seeds its transcript.
  public func resumeChat(_ chat: RemoteStoppedAgent, sessionId: String) async -> RemoteAgentStatus? {
    await spawnAgent(sessionId: sessionId, resumeSessionId: chat.runnerSessionId, runnerId: chat.runnerId)
  }
}
