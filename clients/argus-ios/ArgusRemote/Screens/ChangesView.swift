import ArgusKit
import SwiftUI

/// Read-only changes review: the git status summary plus the diff of what the
/// agent changed. Committing, pushing and conflict resolution stay on the
/// desktop — a phone is where you check, not where you land it.
struct ChangesView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app

  let sessionId: String
  let label: String

  @State private var mode = "branch"
  @State private var diff: String?

  private var files: [DiffFile] { diff.map(DiffParser.parse) ?? [] }

  var body: some View {
    Screen {
      SegmentedControl(
        value: $mode,
        options: [("branch", "Vs base branch"), ("working", "Uncommitted")])

      if let status = app.gitStatusBySession[sessionId] {
        HStack(spacing: 8) {
          StatusDot(tone: status.conflictCount > 0 ? .warning : .accent)
          MutedText(statusLine(status), lineLimit: 1)
        }
      }

      if diff == nil {
        Loading(label: "Loading changes…")
      } else if files.isEmpty {
        EmptyState(
          icon: Icon.branch,
          title: "No changes",
          body: mode == "branch"
            ? "This session has no changes vs its base branch — try Uncommitted for working-tree edits."
            : "No uncommitted changes in the working tree.")
      } else {
        ForEach(files) { file in
          FileDiffCard(file: file)
        }
      }
    }
    .navigationTitle("Changes · \(label)")
    .navigationBarTitleDisplayMode(.inline)
    .liveRefresh(enabled: app.connection == .ready, every: .seconds(5)) { await refresh() }
    .onChange(of: mode) { _, _ in
      diff = nil
      Task { await refresh() }
    }
  }

  private func statusLine(_ status: RemoteGitStatus) -> String {
    var parts = [status.branch]
    if status.ahead > 0 { parts.append("↑\(status.ahead)") }
    if status.behind > 0 { parts.append("↓\(status.behind)") }
    parts.append(status.dirtyCount > 0 ? "\(status.dirtyCount) changed" : "clean")
    if status.conflictCount > 0 { parts.append("\(status.conflictCount) conflicts") }
    return parts.joined(separator: " · ")
  }

  private func refresh() async {
    await app.loadGitStatus(sessionId: sessionId)
    diff = await app.loadDiff(sessionId: sessionId, mode: mode)
  }
}

/// One file's diff, collapsed until you ask for it.
struct FileDiffCard: View {
  @Environment(\.theme) private var theme
  let file: DiffFile
  @State private var expanded = false

  private var tone: Tone {
    switch file.status {
    case .added: .success
    case .deleted: .danger
    case .modified, .renamed: .accent
    }
  }

  var body: some View {
    Card {
      Button {
        expanded.toggle()
      } label: {
        HStack(spacing: 8) {
          Image(systemName: expanded ? Icon.chevronDown : Icon.chevronRight)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(theme.textMuted)
          MonoText(
            text: file.displayPath, size: 12, color: theme.text, lineLimit: 1,
            truncateHead: true)
          Spacer(minLength: 6)
          if file.additions > 0 {
            Text("+\(file.additions)")
              .font(.system(size: 11, design: .monospaced))
              .foregroundStyle(theme.success)
          }
          if file.deletions > 0 {
            Text("-\(file.deletions)")
              .font(.system(size: 11, design: .monospaced))
              .foregroundStyle(theme.error)
          }
          Badge(label: file.status.label, tone: tone)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)

      if file.status == .renamed {
        MutedText("from \(file.oldPath)", lineLimit: 1)
      }

      if expanded {
        if file.isBinary {
          MutedText("Binary file — nothing to show.")
        } else {
          ForEach(file.hunks) { hunk in
            VStack(alignment: .leading, spacing: 0) {
              Text(hunk.header)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(theme.textMuted)
                .padding(.vertical, 4)
                .padding(.horizontal, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.bgTertiary)
              DiffLinesView(lines: hunk.lines)
            }
            .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
          }
        }
      }
    }
  }
}

/// Diff lines with a line-number gutter, collapsed past a dozen rows.
struct DiffLinesView: View {
  @Environment(\.theme) private var theme
  let lines: [DiffLine]
  @State private var showAll = false

  private static let collapsedCount = 12

  var body: some View {
    let visible = showAll ? lines : Array(lines.prefix(Self.collapsedCount))

    VStack(alignment: .leading, spacing: 0) {
      ScrollView(.horizontal, showsIndicators: false) {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(visible) { line in
            HStack(spacing: 6) {
              Text(gutter(line))
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(theme.textMuted)
                .frame(width: 34, alignment: .trailing)
              Text("\(prefix(line))\(line.text)")
                .font(.system(size: 11.5, design: .monospaced))
                .foregroundStyle(color(line))
                .fixedSize(horizontal: true, vertical: false)
            }
            .padding(.vertical, 1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(background(line))
          }
        }
      }
      if lines.count > Self.collapsedCount {
        Button(showAll ? "Collapse" : "See all \(lines.count) lines") { showAll.toggle() }
          .font(.system(size: 12))
          .foregroundStyle(theme.accent)
          .padding(.vertical, 6)
          .padding(.horizontal, 6)
      }
    }
  }

  private func gutter(_ line: DiffLine) -> String {
    switch line.kind {
    case .add: line.newNumber.map(String.init) ?? ""
    case .remove: line.oldNumber.map(String.init) ?? ""
    case .context: line.newNumber.map(String.init) ?? ""
    case .noNewline: ""
    }
  }

  private func prefix(_ line: DiffLine) -> String {
    switch line.kind {
    case .add: "+"
    case .remove: "-"
    case .context: " "
    case .noNewline: "\\"
    }
  }

  private func color(_ line: DiffLine) -> Color {
    switch line.kind {
    case .add: theme.success
    case .remove: theme.error
    case .context: theme.textSecondary
    case .noNewline: theme.textMuted
    }
  }

  private func background(_ line: DiffLine) -> Color {
    switch line.kind {
    case .add: theme.successSoft
    case .remove: theme.errorSoft
    default: .clear
    }
  }
}
