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

  var body: some View {
    Screen {
      if let file {
        ChangedFileRow(file: file, showsChevron: false)
        if file.status == .renamed {
          MutedText("from \(file.oldPath)", lineLimit: 1)
        }
        DiffHunksView(file: file, collapsesLongHunks: false)
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
  }

  private func refresh() async {
    do {
      let diff = try await host.loadDiff(sessionId: sessionId, mode: mode)
      file = DiffParser.parse(diff).first { $0.displayPath == path }
      failure = nil
      loaded = true
    } catch where !HostStore.isCancellation(error) {
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
      if showsChevron {
        Image(systemName: Icon.chevronRight)
          .font(.scaled(.caption).weight(.semibold))
          .foregroundStyle(.tertiary)
      }
    }
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
