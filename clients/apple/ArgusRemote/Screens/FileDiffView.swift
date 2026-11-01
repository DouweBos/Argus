import ArgusUI
import SwiftUI

/// One changed file from the Changes list: its row, then every hunk in full.
struct FileDiffView: View {
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router

  let sessionId: String
  let path: String
  let mode: String

  @State private var file: DiffFile?
  @State private var loaded = false

  var body: some View {
    Screen {
      if let file {
        ChangedFileRow(file: file, showsChevron: false)
        if file.status == .renamed {
          MutedText("from \(file.oldPath)", lineLimit: 1)
        }
        DiffHunksView(file: file, collapsesLongHunks: false)
      } else if loaded {
        EmptyState(icon: Icon.branch, title: "No changes", body: "This file no longer differs.")
      } else {
        Loading(label: "Loading changes…")
      }
    }
    .navigationTitle(SessionFilePaths.fileName(path))
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if host.hasControl, let file, file.status != .deleted {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            router.push(.file(sessionId: sessionId, path: path, line: file.firstChangedLine, source: .changes))
          } label: {
            Label("View file", systemImage: Icon.file)
          }
        }
      }
    }
    .liveRefresh(enabled: host.connection == .ready, every: .seconds(5)) { await refresh() }
  }

  private func refresh() async {
    let diff = await host.loadDiff(sessionId: sessionId, mode: mode)
    file = DiffParser.parse(diff).first { $0.displayPath == path }
    loaded = true
  }
}

/// A changed file as a list row: icon, path, counts and what happened to it.
struct ChangedFileRow: View {
  @Environment(\.theme) private var theme
  let file: DiffFile
  var showsChevron = true

  var body: some View {
    HStack(spacing: 8) {
      FileTypeIcon(path: file.displayPath, size: 14)
      MonoText(text: file.displayPath, size: 12, color: theme.text, lineLimit: 1, truncateHead: true)
      Spacer(minLength: 6)
      if ChangeCounts.hasChanges(additions: file.additions, deletions: file.deletions) {
        ChangeCounts(additions: file.additions, deletions: file.deletions)
      }
      Badge(label: file.status.label, tone: file.status.tone)
      if showsChevron {
        Image(systemName: Icon.chevronRight)
          .font(.scaled(.caption).weight(.semibold))
          .foregroundStyle(.tertiary)
      }
    }
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }
}
