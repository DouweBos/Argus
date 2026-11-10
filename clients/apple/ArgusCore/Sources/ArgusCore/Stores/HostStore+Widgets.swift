import ArgusKit
import Foundation

/// This computer's slice of the phone's widgets, from what the stores already hold.
extension WidgetSnapshot.Host {
  /// Past this many rows no widget family has room, and the counts carry the rest.
  public static let agentLimit = 8
  public static let proposalLimit = 4

  @MainActor
  public init(host: HostStore, proposals: [RemoteProposal], id: String, name: String, now: Date = Date()) {
    let agents = host.recentAgentsByActivity.compactMap { agent -> WidgetSnapshot.Agent? in
      let attention = Labels.awaitingLabel(agent) ?? (agent.status == .requiresAction ? "needs you" : nil)
      guard attention != nil || agent.status == .running else { return nil }
      let location = ArgusLocation(route: .session(id: agent.sessionId, agentId: agent.agentId), host: id)
      return WidgetSnapshot.Agent(
        id: agent.agentId, title: Labels.agentName(agent), project: agent.projectName, attention: attention,
        activityAt: agent.lastActivityAt.map { Date(timeIntervalSince1970: $0 / 1000) },
        url: WidgetLink.url(path: location.path))
    }
    // Waiting ones first, so the cut never drops an agent that needs you.
    let ordered = agents.filter(\.needsYou) + agents.filter { !$0.needsYou }
    let pending = proposals.filter { $0.inboxPhase == .pending }
    self.init(
      id: id, name: name, updatedAt: now,
      agents: Array(ordered.prefix(Self.agentLimit)),
      proposals: pending.prefix(Self.proposalLimit).map { proposal in
        let location = ArgusLocation(route: .proposal(id: proposal.id), host: id)
        return .init(id: proposal.id, title: proposal.title, url: WidgetLink.url(path: location.path))
      },
      proposalCount: pending.count,
      usage: Self.usage(host.usageLimits))
  }

  /// The five-hour and weekly bars of the Usage screen, per signed-in account.
  static func usage(_ limits: ArgusProtocol.ClaudeUsageLimits?) -> [WidgetSnapshot.UsageAccount] {
    (limits?.accounts ?? []).filter { $0.status == .ok }.compactMap { account in
      func window(_ kind: ArgusProtocol.UsageLimitWindowKind) -> WidgetSnapshot.UsageWindow? {
        // The plan-wide weekly window, not a per-model one ("Weekly · Opus").
        let matching = account.windows.filter { $0.kind == kind }
        return (matching.first { !$0.label.contains("·") } ?? matching.first).map {
          .init(usedPercent: $0.usedPercent, resetsAt: $0.resetsAt.map { Date(timeIntervalSince1970: $0 / 1000) })
        }
      }
      let session = window(.session)
      let weekly = window(.weekly)
      guard session != nil || weekly != nil else { return nil }
      return .init(label: account.label, session: session, weekly: weekly)
    }
  }
}
