import ArgusKit
import Foundation

/// One runner/model a compare run starts the prompt on.
public struct CompareSlot: Hashable, Sendable, Identifiable {
  public let id: UUID
  /// Nil is the computer's default runner.
  public var runnerId: String?
  /// Nil lets the runner choose.
  public var model: String?
  public var effort: String?

  public init(id: UUID = UUID(), runnerId: String? = nil, model: String? = nil, effort: String? = nil) {
    self.id = id
    self.runnerId = runnerId
    self.model = model
    self.effort = effort
  }

  public static let minimum = 2
  public static let maximum = 5
}

/// Where a compare slot's run command or test run stands.
public enum CompareRunState: String, Codable, Hashable, Sendable {
  case running, passed, failed
}

/// A `.argus.json` run command a slot has started.
public struct CompareRunCommand: Codable, Hashable, Sendable {
  public var title: String
  public var state: CompareRunState
  public var isTest: Bool

  public init(title: String, state: CompareRunState, isTest: Bool) {
    self.title = title
    self.state = state
    self.isTest = isTest
  }

  enum CodingKeys: String, CodingKey {
    case title, state
    case isTest = "is_test"
  }
}

/// A slot's changes against its base, uncommitted work included.
public struct CompareDiffStat: Codable, Hashable, Sendable {
  public var files: Int
  public var insertions: Int
  public var deletions: Int

  public init(files: Int, insertions: Int, deletions: Int) {
    self.files = files
    self.insertions = insertions
    self.deletions = deletions
  }
}

/// One slot of a compare run as the computer scores it.
public struct CompareSlotScore: Codable, Hashable, Sendable, Identifiable {
  public var sessionId: String
  public var slot: Int
  public var runnerId: String?
  public var model: String?
  public var effort: String?
  public var agentId: String?
  public var agentStatus: RemoteAgentState?
  public var diff: CompareDiffStat?
  public var runs: [CompareRunCommand]
  public var costUsd: Double
  public var tokens: Int
  public var hasScreen: Bool

  public var id: String { sessionId }

  public init(
    sessionId: String, slot: Int, runnerId: String? = nil, model: String? = nil, effort: String? = nil,
    agentId: String? = nil, agentStatus: RemoteAgentState? = nil, diff: CompareDiffStat? = nil,
    runs: [CompareRunCommand] = [], costUsd: Double = 0, tokens: Int = 0, hasScreen: Bool = false
  ) {
    self.sessionId = sessionId
    self.slot = slot
    self.runnerId = runnerId
    self.model = model
    self.effort = effort
    self.agentId = agentId
    self.agentStatus = agentStatus
    self.diff = diff
    self.runs = runs
    self.costUsd = costUsd
    self.tokens = tokens
    self.hasScreen = hasScreen
  }

  /// Run commands other than tests.
  public var appRuns: [CompareRunCommand] { runs.filter { !$0.isTest } }
  public var testRuns: [CompareRunCommand] { runs.filter(\.isTest) }

  /// The worst of a set: any failure fails it, then any still running; nil when there are none.
  public static func summary(_ runs: [CompareRunCommand]) -> CompareRunState? {
    if runs.isEmpty { return nil }
    if runs.contains(where: { $0.state == .failed }) { return .failed }
    if runs.contains(where: { $0.state == .running }) { return .running }
    return .passed
  }

  /// Still working: no agent yet, or its agent mid-turn.
  public var isWorking: Bool { agentId == nil || agentStatus == .running }

  enum CodingKeys: String, CodingKey {
    case slot, model, effort, diff, runs, tokens
    case sessionId = "session_id"
    case runnerId = "runner_id"
    case agentId = "agent_id"
    case agentStatus = "agent_status"
    case costUsd = "cost_usd"
    case hasScreen = "has_screen"
  }
}

/// How a kept slot lands.
public enum CompareLanding: String, Sendable, CaseIterable {
  case merge
  case pullRequest = "pull_request"
  case none

  public var label: String {
    switch self {
    case .merge: "Merge into base"
    case .pullRequest: "Open a pull request"
    case .none: "Keep the branch as it is"
    }
  }
}

/// The sessions of one compare run, in slot order.
public struct CompareGroup: Hashable, Sendable, Identifiable {
  public let id: String
  public let sessions: [RemoteSession]

  public init(id: String, sessions: [RemoteSession]) {
    self.id = id
    self.sessions = sessions
  }

  /// The run's name: its sessions share the prompt, so the first one's.
  public var title: String { sessions.first?.displayName ?? sessions.first?.branch ?? "Compare" }

  /// Compare runs among `sessions`, each where its first slot sits, and the sessions outside any.
  /// A run down to one slot (the others deleted) reads as a plain session.
  public static func split(_ sessions: [RemoteSession]) -> [CompareListItem] {
    var byGroup: [String: [RemoteSession]] = [:]
    for session in sessions {
      if let group = session.compareGroup { byGroup[group.id, default: []].append(session) }
    }
    var seen: Set<String> = []
    var items: [CompareListItem] = []
    for session in sessions {
      guard let groupId = session.compareGroup?.id, let members = byGroup[groupId], members.count > 1 else {
        items.append(.session(session))
        continue
      }
      guard seen.insert(groupId).inserted else { continue }
      let ordered = members.sorted { ($0.compareGroup?.slot ?? 0) < ($1.compareGroup?.slot ?? 0) }
      items.append(.group(CompareGroup(id: groupId, sessions: ordered)))
    }
    return items
  }
}

extension CompareGroup {
  /// The sessions in the order `split` shows them: a run's slots together where its first slot sits.
  public static func displayOrder(_ sessions: [RemoteSession]) -> [RemoteSession] {
    split(sessions).flatMap { item -> [RemoteSession] in
      switch item {
      case .session(let session): [session]
      case .group(let run): run.sessions
      }
    }
  }
}

/// A row of a session list: a session, or a compare run's header with its slots.
public enum CompareListItem: Hashable, Sendable, Identifiable {
  case session(RemoteSession)
  case group(CompareGroup)

  public var id: String {
    switch self {
    case .session(let session): session.id
    case .group(let group): "compare:\(group.id)"
    }
  }
}
