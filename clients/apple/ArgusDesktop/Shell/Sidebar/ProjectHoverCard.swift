import ArgusCore
import ArgusUI
import SwiftUI

/// What resting the pointer on a sidebar project shows: where it lives, the
/// root checkout's branch and git state, and how many sessions are at work.
struct ProjectHoverCard: View {
  @Environment(\.theme) private var theme
  let project: RemoteProject
  let root: RemoteSession?
  let git: RemoteGitStatus?
  let rootAgents: [RemoteAgentStatus]
  let sessions: [SessionActivity]

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      VStack(alignment: .leading, spacing: 3) {
        Text(project.name)
          .font(.scaled(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
          .lineLimit(2)
        Text(project.repoRoot)
          .font(.scaled(size: 11).monospaced())
          .foregroundStyle(theme.textSecondary)
          .lineLimit(1)
          .truncationMode(.middle)
        if let branch {
          Label {
            Text(branch).font(.scaled(size: 11).monospaced()).lineLimit(1).truncationMode(.middle)
          } icon: {
            Image(systemName: Icon.branch)
          }
          .font(.scaled(size: 11))
          .foregroundStyle(theme.textSecondary)
        }
      }
      Divider().overlay(theme.borderSubtle)
      Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 10, verticalSpacing: 5) {
        ForEach(facts) { fact in
          GridRow {
            Text(fact.label)
              .font(.scaled(size: 11))
              .foregroundStyle(theme.textMuted)
              .gridColumnAlignment(.trailing)
            SessionFactValue(fact, size: 11)
          }
        }
      }
    }
    .padding(12)
    .frame(width: 260, alignment: .leading)
    .floatingSurface()
  }

  private var branch: String? { git?.branch ?? root?.branch }

  /// Session counts first, then the root checkout's own facts.
  private var facts: [SessionFact] {
    var facts = [SessionFact("Sessions", .text(sessions.isEmpty ? "None" : "\(sessions.count)"))]
    let working = sessions.filter { $0.state == .working }.count
    let waiting = sessions.filter { $0.state == .waiting }.count
    if working > 0 { facts.append(SessionFact("Working", .text("\(working)"))) }
    if waiting > 0 { facts.append(SessionFact("Needs you", .text("\(waiting)"), emphasis: .warning)) }
    if let root {
      // The branch is already in the header.
      facts += SessionActivity(session: root, agents: rootAgents).facts(git: git).filter { $0.label != "Base" }
    }
    return facts
  }
}
