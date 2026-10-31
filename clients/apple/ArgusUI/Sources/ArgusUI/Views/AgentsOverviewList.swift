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

  private var agents: [RemoteAgentStatus] { host.recentAgentsByActivity }

  public var body: some View {
    let agents = agents
    List {
      if !agents.isEmpty {
        // The large title's subtitle, not a section heading over the rows.
        Text(Self.summary(agents))
          .font(.scaled(.footnote))
          .foregroundStyle(.secondary)
          .listRowBackground(Color.clear)
          .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
        Section {
          ForEach(agents) { agent in
            Button { open(agent) } label: {
              HStack(spacing: 8) {
                AgentRow(
                  name: Labels.agentName(agent), status: agent.status,
                  attention: Labels.awaitingLabel(agent),
                  meta: [agent.projectName, agent.sessionLabel]
                    .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                // It pushes, so it says so the way a NavigationLink would.
                Image(systemName: Icon.chevronRight)
                  .font(.scaled(.footnote).weight(.semibold))
                  .foregroundStyle(.tertiary)
              }
              .contentShape(Rectangle())
            }
            .buttonStyle(.argusPlain)
          }
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
