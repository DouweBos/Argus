import ArgusCore
import SwiftUI

/// Every agent on the computer, across projects and sessions: the ones
/// working or waiting on you first. The phone's counterpart of `/agents`.
public struct AgentsOverviewList: View {
  @Environment(HostStore.self) private var host
  let open: (RemoteAgentStatus) -> Void

  public init(open: @escaping (RemoteAgentStatus) -> Void) {
    self.open = open
  }

  private var agents: [RemoteAgentStatus] {
    host.recentAgents.sorted {
      let (left, right) = (Labels.activityRank($0), Labels.activityRank($1))
      return left != right ? left < right : Labels.lastActivity($0) > Labels.lastActivity($1)
    }
  }

  public var body: some View {
    let agents = agents
    List {
      if !agents.isEmpty {
        Section {
          ForEach(agents) { agent in
            Button { open(agent) } label: {
              AgentRow(
                name: Labels.agentName(agent), status: agent.status,
                attention: Labels.awaitingLabel(agent),
                meta: [agent.projectName, agent.sessionLabel]
                  .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
            }
            .buttonStyle(.plain)
          }
        } header: {
          Text(Self.summary(agents))
        }
      }
    }
    // Over the list, not in it: a row only gets its own height.
    .overlay {
      if agents.isEmpty {
        EmptyState(icon: Icon.agent, title: "No agents", body: "Start one from a session to see it here.")
      }
    }
    .refreshable { await host.loadRecentAgents() }
    // Status events only reach agents this phone is subscribed to, so a list
    // spanning every agent polls to see new ones start and others finish.
    .liveRefresh(enabled: host.connection == .ready, every: .seconds(5)) {
      await host.loadRecentAgents()
    }
  }

  /// "3 total · 1 running · 2 idle · 0 errored", as the desktop's overview says.
  public static func summary(_ agents: [RemoteAgentStatus]) -> String {
    let count = { (state: RemoteAgentState) in agents.filter { $0.status == state }.count }
    return "\(agents.count) total · \(count(.running)) running · \(count(.idle)) idle · \(count(.error)) errored"
  }
}
