import ArgusUI
import SwiftUI

/// One changed file from the Changes list: its row, then every hunk in full.
struct FileDiffView: View {
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(\.stackPush) private var stackPush

  let sessionId: String
  let path: String
  let mode: String

  @State private var file: DiffFile?
  @State private var loaded = false
  @State private var failure: String?
  @State private var composing: Composing?
  @State private var viewed: ViewedFiles?

  /// The comment sheet: a new comment on a line, or an edit of a draft.
  private struct Composing: Identifiable {
    let comment: DiffReviewComment
    let isNew: Bool
    var id: UUID { comment.id }
  }

  private var scope: String { mode == "branch" ? "changes on this branch" : "uncommitted changes" }

  var body: some View {
    Screen {
      if let file {
        ChangedFileRow(file: file, showsChevron: false)
        if file.status == .renamed {
          MutedText("from \(file.oldPath)", lineLimit: 1)
        }
        if let viewed {
          ViewedToggle(
            state: viewed.state(file.displayPath),
            onChange: host.hasControl ? { on in Task { await viewed.set(file.displayPath, viewed: on) } } : nil)
          if let error = viewed.error { Banner(text: error, tone: .danger) }
        }
        if host.hasControl {
          ReviewableDiffHunksView(
            file: file, comments: host.reviews.comments(sessionId, path: file.displayPath),
            onTapLine: { hunk, line in
              if let draft = DiffReviewComment.draft(path: file.displayPath, hunk: hunk, line: line, scope: scope) {
                composing = Composing(comment: draft, isNew: true)
              }
            },
            onEdit: { composing = Composing(comment: $0, isNew: false) },
            onDelete: { host.deleteReviewComment($0.id, sessionId: sessionId) })
        } else {
          DiffHunksView(file: file, collapsesLongHunks: false)
        }
      } else if let failure {
        EmptyState(icon: Icon.warning, title: "Couldn't load changes", body: failure, selectable: true) {
          Btn(label: "Retry", tone: .secondary, small: true, icon: Icon.refresh) { Task { await refresh() } }
            .fixedSize()
        }
      } else if loaded {
        EmptyState(icon: Icon.branch, title: "No changes", body: "This file no longer differs.")
      } else {
        Loading(label: "Loading changes…")
      }
    }
    .navigationTitle(SessionFilePaths.fileName(path))
    .navigationBarTitleDisplayMode(.inline)
    .screenBar {
      if host.hasControl, let file, file.status != .deleted {
        Button {
          (stackPush ?? router.push)(.file(sessionId: sessionId, path: path, line: file.firstChangedLine, source: .changes))
        } label: {
          Label("View file", systemImage: Icon.file)
        }
      }
    }
    .liveRefresh(enabled: host.connection == .ready, every: .seconds(5)) { await refresh() }
    .loadsOffline { await refresh() }
    .sheet(item: $composing) { composing in
      DiffCommentSheet(
        title: composing.isNew ? "Line \(composing.comment.lines.lowerBound)" : "Edit comment",
        submitTitle: composing.isNew ? "Add" : "Save", text: composing.comment.body
      ) { body in
        if composing.isNew {
          var comment = composing.comment
          comment.body = body
          host.addReviewComment(comment, sessionId: sessionId)
        } else {
          host.reviews.update(composing.comment.id, body: body, sessionId: sessionId)
        }
      }
    }
    .diffReviewBar(sessionId: sessionId) { agentId in
      let label = host.statusByAgent[agentId].map(Labels.agentName) ?? "Agent"
      (stackPush ?? router.push)(.agent(id: agentId, label: label))
    }
  }

  private func refresh() async {
    if viewed == nil { viewed = ViewedFiles(scope: .session(id: sessionId, mode: mode), host: host) }
    await viewed?.load()
    do {
      let diff = try await host.loadDiff(sessionId: sessionId, mode: mode)
      file = DiffParser.parse(diff).first { $0.displayPath == path }
      failure = nil
      loaded = true
    } catch where !HostStore.isQuiet(error) {
      failure = HostStore.describe(error)
    } catch {}
  }
}

/// A changed file as a list row: icon, path, counts and what happened to it.
struct ChangedFileRow: View {
  @Environment(\.theme) private var theme
  @Environment(\.dynamicTypeSize) private var typeSize
  let file: DiffFile
  var showsChevron = true
  var viewedState: ViewedFiles.State?

  var body: some View {
    HStack(spacing: 8) {
      FileTypeIcon(path: file.displayPath, size: 14)
      // At accessibility sizes the path gets a line of its own rather than "…".
      if typeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: 4) {
          path
          HStack(spacing: 8) { facts }
        }
        Spacer(minLength: 0)
      } else {
        path
        Spacer(minLength: 6)
        facts
      }
      switch viewedState {
      case .viewed?:
        Image(systemName: "checkmark.circle.fill").foregroundStyle(theme.textMuted).accessibilityLabel("Viewed")
      case .changed?:
        Image(systemName: "circle.lefthalf.filled").foregroundStyle(theme.warning)
          .accessibilityLabel("Changed since viewed")
      default:
        EmptyView()
      }
      if showsChevron {
        Image(systemName: Icon.chevronRight)
          .font(.scaled(.caption).weight(.semibold))
          .foregroundStyle(.tertiary)
      }
    }
    .opacity(viewedState == .viewed ? 0.6 : 1)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }

  private var path: some View {
    MonoText(text: file.displayPath, size: 12, color: theme.text, lineLimit: 1, truncateHead: true)
  }

  @ViewBuilder private var facts: some View {
    if ChangeCounts.hasChanges(additions: file.additions, deletions: file.deletions) {
      ChangeCounts(additions: file.additions, deletions: file.deletions)
    }
    Badge(label: file.status.label, tone: file.status.tone)
  }
}
