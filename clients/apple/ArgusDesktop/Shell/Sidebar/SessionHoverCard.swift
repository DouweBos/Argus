import ArgusCore
import ArgusUI
import SwiftUI

/// What resting the pointer on a sidebar session shows: its branch and where
/// it came from, how much it changed, how it stands against its upstream, and
/// what its agents are up to.
struct SessionHoverCard: View {
  @Environment(\.theme) private var theme
  let session: RemoteSession
  let git: RemoteGitStatus?
  let activity: SessionActivity

  private var branch: String { git?.branch ?? session.branch }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      VStack(alignment: .leading, spacing: 3) {
        Text(session.displayName ?? session.branch)
          .font(.scaled(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
          .lineLimit(2)
        Label {
          Text(branch).font(.scaled(size: 11).monospaced()).lineLimit(1).truncationMode(.middle)
        } icon: {
          Image(systemName: Icon.branch)
        }
        .font(.scaled(size: 11))
        .foregroundStyle(theme.textSecondary)
      }
      Divider().overlay(theme.borderSubtle)
      Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 10, verticalSpacing: 5) {
        if let base = session.baseBranch, base != branch { row("Base") { value(base, mono: true) } }
        if let git { gitRows(git) }
        if let status = activity.statusText {
          row("Agents") { value(status, tone: session.status == .error ? .danger : nil) }
        }
        if let lastActive = activity.lastActive {
          row("Active") { value("\(ChromeText.shortAge(lastActive)) ago") }
        }
        if let volume = session.volume { row("Drive") { value(volume) } }
      }
    }
    .padding(12)
    .frame(width: 260, alignment: .leading)
    .floatingSurface()
  }

  @ViewBuilder private func gitRows(_ git: RemoteGitStatus) -> some View {
    let additions = git.diffAdditions ?? 0
    let deletions = git.diffDeletions ?? 0
    row("Changes") {
      if ChangeCounts.hasChanges(additions: additions, deletions: deletions) {
        ChangeCounts(additions: additions, deletions: deletions).font(.scaled(size: 11).monospacedDigit())
      } else {
        value("None")
      }
    }
    if git.dirtyCount > 0 {
      row("Uncommitted") { value("\(git.dirtyCount) file\(git.dirtyCount == 1 ? "" : "s")") }
    }
    row("Upstream") { value(upstream(git), tone: git.behind > 0 ? .warning : nil) }
    if git.conflictCount > 0 {
      row("Conflicts") { value("\(git.conflictCount) file\(git.conflictCount == 1 ? "" : "s")", tone: .danger) }
    }
    if let progress = git.inProgress {
      row("In progress") {
        value(progress.onto.map { "\(progress.kind.capitalized) onto \($0)" } ?? progress.kind.capitalized, tone: .warning)
      }
    }
    if git.stashCount > 0 { row("Stashes") { value("\(git.stashCount)") } }
  }

  private func upstream(_ git: RemoteGitStatus) -> String {
    guard let upstream = git.upstream else { return "Not pushed" }
    var parts: [String] = []
    if git.ahead > 0 { parts.append("↑\(git.ahead)") }
    if git.behind > 0 { parts.append("↓\(git.behind)") }
    return parts.isEmpty ? "Up to date with \(upstream)" : "\(parts.joined(separator: " ")) \(upstream)"
  }

  private func row(_ label: String, @ViewBuilder content: () -> some View) -> some View {
    GridRow {
      Text(label)
        .font(.scaled(size: 11))
        .foregroundStyle(theme.textMuted)
        .gridColumnAlignment(.trailing)
      content()
    }
  }

  private func value(_ text: String, mono: Bool = false, tone: Tone? = nil) -> some View {
    Text(text)
      .font(mono ? .scaled(size: 11).monospaced() : .scaled(size: 11))
      .foregroundStyle(tone?.color(theme) ?? theme.textSecondary)
      .lineLimit(2)
      .truncationMode(.middle)
  }
}
