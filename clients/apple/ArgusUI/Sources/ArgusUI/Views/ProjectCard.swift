import ArgusCore
import ArgusKit
import SwiftUI

/// A project on home: badge and name, where it lives, and its activity. The
/// Mac's grid and the phone's both draw it; each wraps it in its own tap.
public struct ProjectCard<Accessory: View>: View {
  @Environment(\.theme) private var theme
  let project: RemoteProject
  let agents: [RemoteAgentStatus]
  let sessions: Int
  var highlighted: Bool
  @ViewBuilder let accessory: () -> Accessory

  public init(
    project: RemoteProject, agents: [RemoteAgentStatus], sessions: Int, highlighted: Bool = false,
    @ViewBuilder accessory: @escaping () -> Accessory
  ) {
    self.project = project
    self.agents = agents
    self.sessions = sessions
    self.highlighted = highlighted
    self.accessory = accessory
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        ProjectBadge(project.name, key: project.repoRoot, size: 20)
        Text(project.name).font(.scaled(size: 14, weight: .semibold)).foregroundStyle(theme.text).lineLimit(1)
        Spacer(minLength: 4)
        accessory()
      }
      Text(HostScopedPath.path(project.repoRoot))
        .font(.scaled(.caption)).foregroundStyle(theme.textMuted).lineLimit(1).truncationMode(.middle)
      ProjectActivityLine(agents: agents, sessions: sessions)
    }
    .padding(12)
    .background(highlighted ? theme.bgHover : theme.bgSecondary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radius))
    .overlay(RoundedRectangle(cornerRadius: theme.radius).stroke(theme.borderSubtle))
    .contentShape(Rectangle())
  }
}
