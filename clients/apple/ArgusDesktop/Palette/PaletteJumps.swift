import ArgusUI
import Foundation

/// The palette's jumps to one specific thing: a chat, a terminal or run, an
/// open editor tab. Pure, so building and ranking are testable without a host.
enum PaletteJumps {
  static let chatsSection = "Chats"
  static let terminalsSection = "Terminals"
  static let filesSection = "Files"
  static let sections = [chatsSection, terminalsSection, filesSection]
  /// With nothing typed, each jump section shows only its first few.
  static let emptyQueryCap = 5

  /// A session as the jumps label it: "session · project".
  struct Place: Equatable {
    let sessionId: String
    let name: String
    let project: String
    var subtitle: String { "\(name) · \(project)" }
  }

  enum Target: Equatable {
    case agent(sessionId: String, agentId: String)
    /// A saved chat, resumed in a new agent when picked.
    case savedChat(sessionId: String, historyId: String)
    case terminal(sessionId: String, terminalId: String)
    case file(sessionId: String, path: String)
  }

  struct Jump: Equatable {
    let id: String
    let title: String
    let subtitle: String
    let section: String
    let systemImage: String
    var keywords: [String] = []
    let target: Target
  }

  struct LiveChat {
    let agentId: String
    let title: String
    /// Milliseconds since 1970.
    let lastActive: Double
    let runnerSessionId: String?
  }

  struct SavedChat {
    let historyId: String
    let title: String
    let endedAt: Double
    let runnerSessionId: String
  }

  struct Terminal {
    let id: String
    let title: String
    let isRun: Bool
  }

  /// Live chats and saved ones, newest first, the current session's ahead. A
  /// saved chat already resumed into a live agent is left out.
  static func chats(
    _ places: [Place], live: [String: [LiveChat]], saved: [String: [SavedChat]], current: String?
  ) -> [Jump] {
    let entries = places.flatMap { place -> [(Jump, Double)] in
      let agents = live[place.sessionId] ?? []
      let resumed = Set(agents.compactMap(\.runnerSessionId))
      let liveJumps = agents.map { chat in
        (
          Jump(
            id: "chat.agent.\(chat.agentId)", title: chat.title, subtitle: place.subtitle, section: chatsSection,
            systemImage: Icon.agent, keywords: ["chat", "agent"],
            target: .agent(sessionId: place.sessionId, agentId: chat.agentId)), chat.lastActive
        )
      }
      let savedJumps = (saved[place.sessionId] ?? []).filter { !resumed.contains($0.runnerSessionId) }.map { chat in
        (
          Jump(
            id: "chat.saved.\(chat.historyId)", title: chat.title, subtitle: place.subtitle, section: chatsSection,
            systemImage: Icon.history, keywords: ["chat", "recent", "resume"],
            target: .savedChat(sessionId: place.sessionId, historyId: chat.historyId)), chat.endedAt
        )
      }
      return liveJumps + savedJumps
    }
    return currentFirst(entries.sorted { $0.1 > $1.1 }.map(\.0), current: current)
  }

  /// Every terminal and run tab, runs first within a session, the current session's ahead.
  static func terminals(_ places: [Place], tabs: [String: [Terminal]], current: String?) -> [Jump] {
    let jumps = places.flatMap { place in
      (tabs[place.sessionId] ?? []).map { tab in
        Jump(
          id: "terminal.\(tab.id)", title: tab.title, subtitle: place.subtitle, section: terminalsSection,
          systemImage: tab.isRun ? Icon.play : Icon.terminal, keywords: tab.isRun ? ["run"] : ["terminal", "shell"],
          target: .terminal(sessionId: place.sessionId, terminalId: tab.id))
      }
    }
    return currentFirst(jumps, current: current)
  }

  /// Open editor tabs, the latest opened first, the current session's ahead.
  static func files(_ places: [Place], tabs: [String: [String]], current: String?) -> [Jump] {
    let jumps = places.flatMap { place in
      (tabs[place.sessionId] ?? []).reversed().map { path in
        let name = (path as NSString).lastPathComponent
        let folder = (path as NSString).deletingLastPathComponent
        return Jump(
          id: "file.\(place.sessionId).\(path)", title: name,
          subtitle: folder.isEmpty ? place.subtitle : "\(folder) · \(place.subtitle)", section: filesSection,
          systemImage: Icon.file, keywords: [path],
          target: .file(sessionId: place.sessionId, path: path))
      }
    }
    return currentFirst(jumps, current: current)
  }

  /// Stable: the current session's jumps move ahead, each side keeps its order.
  static func currentFirst(_ jumps: [Jump], current: String?) -> [Jump] {
    guard let current else { return jumps }
    let mine = jumps.filter { $0.target.sessionId == current }
    return mine + jumps.filter { $0.target.sessionId != current }
  }

  /// With an empty query each jump section is cut to `emptyQueryCap`; typing searches them all.
  static func capped<Item>(_ items: [Item], query: String, section: (Item) -> String) -> [Item] {
    guard query.trimmingCharacters(in: .whitespaces).isEmpty else { return items }
    var counts: [String: Int] = [:]
    return items.filter { item in
      let name = section(item)
      guard sections.contains(name) else { return true }
      let count = (counts[name] ?? 0) + 1
      counts[name] = count
      return count <= emptyQueryCap
    }
  }
}

extension PaletteJumps.Target {
  var sessionId: String {
    switch self {
    case .agent(let id, _), .savedChat(let id, _), .terminal(let id, _), .file(let id, _): id
    }
  }
}
