import Foundation

/// What a session's agents are up to, as one state and a line of text. The
/// Mac sidebar and the phone's project screens read the same thing.
public struct SessionActivity: Sendable {
  public let session: RemoteSession
  public let agents: [RemoteAgentStatus]

  public init(session: RemoteSession, agents: [RemoteAgentStatus]) {
    self.session = session
    self.agents = agents
  }

  /// One step coarser than the status: what a dot beside the session says.
  public enum State: Sendable, Equatable {
    case unavailable, failed, preparing, waiting, working, unread, idle
  }

  public var isBusy: Bool {
    session.status == .initializing || agents.contains { $0.status == .running }
  }

  public var state: State {
    if session.isUnavailable { return .unavailable }
    switch session.status {
    case .error: return .failed
    case .initializing, .deleting: return .preparing
    case .ready:
      if agents.contains(where: { $0.awaiting != nil }) { return .waiting }
      if isBusy { return .working }
      return session.unread == true ? .unread : .idle
    }
  }

  /// Worth a dot: working, waiting on you, finished unread, broken, or setting up. An idle session shows none.
  public var showsDot: Bool {
    switch state {
    case .failed, .waiting, .working, .unread: true
    case .preparing: session.status == .initializing
    case .unavailable, .idle: false
    }
  }

  /// "Setting up…", "Deleting…" or "Setup failed"; nil once ready.
  public static func statusLabel(_ status: RemoteSessionStatus) -> String? {
    switch status {
    case .initializing: "Setting up…"
    case .deleting: "Deleting…"
    case .error: "Setup failed"
    case .ready: nil
    }
  }

  /// "Setting up…", the error, or how many agents there are.
  public var statusText: String? {
    switch session.status {
    case .error: session.setupError ?? Self.statusLabel(.error)
    case .ready: agents.isEmpty ? nil : "\(agents.count) agent\(agents.count == 1 ? "" : "s")"
    case .initializing, .deleting: Self.statusLabel(session.status)
    }
  }

  /// When one of its agents last did something, in epoch milliseconds.
  public var lastActive: Double? {
    agents.compactMap { $0.lastActivityAt ?? $0.createdAt }.max()
  }
}

/// How a session stands against its upstream, as one line.
public enum GitUpstreamText {
  public static func describe(_ git: RemoteGitStatus) -> String {
    guard let upstream = git.upstream else { return "Not pushed" }
    var parts: [String] = []
    if git.ahead > 0 { parts.append("↑\(git.ahead)") }
    if git.behind > 0 { parts.append("↓\(git.behind)") }
    return parts.isEmpty ? "Up to date with \(upstream)" : "\(parts.joined(separator: " ")) \(upstream)"
  }

  /// Whether there is anything to say beyond "up to date".
  public static func isNoteworthy(_ git: RemoteGitStatus) -> Bool {
    git.upstream == nil || git.ahead > 0 || git.behind > 0
  }
}
