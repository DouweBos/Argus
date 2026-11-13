import ArgusCore
import ArgusUI
import GroveKit
import SwiftUI

/// Picks what the session's diff covers: the working copy, the last turn, an earlier turn or the whole branch.
struct DiffScopeMenu: View {
  let workspace: GitWorkspace

  private var scoped: ScopedDiffModel { workspace.scopedDiff }

  var body: some View {
    Menu {
      Picker("Show", selection: Binding(get: { scoped.scope }, set: { scoped.pick($0) })) {
        Text("Uncommitted Changes").tag(SessionDiffScope.uncommitted)
        Text("Last Turn").tag(SessionDiffScope.lastTurn)
        if !workspace.isProjectRoot {
          Text("Whole Branch").tag(SessionDiffScope.branch)
        }
      }
      .pickerStyle(.inline)
      if scoped.turns.count > 1 {
        Section("Turns") {
          ForEach(scoped.turns.reversed()) { turn in
            Button { scoped.pick(.turn(turn)) } label: {
              Text("Turn \(turn.number) · \(turn.prompt.isEmpty ? "No text" : turn.prompt)")
            }
          }
        }
      }
    } label: {
      Text(scoped.scope.title)
    }
    .menuStyle(.borderlessButton)
    .fixedSize()
    .clickable()
    .help("What the diff covers")
    .accessibilityLabel("Diff Scope")
    .task(id: workspace.generation) { await scoped.loadTurns() }
  }
}

/// The files an agent turn or the whole branch changed, under the scope picker.
struct ScopedChangesList: View {
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace

  private var scoped: ScopedDiffModel { workspace.scopedDiff }

  var body: some View {
    VStack(spacing: 0) {
      PanelHeader(title: "Files", detail: scoped.files.isEmpty ? nil : "\(scoped.files.count) changed") {
        DiffScopeMenu(workspace: workspace)
      }
      if let turn = scoped.turn, !turn.prompt.isEmpty {
        Text(turn.prompt)
          .font(.scaled(size: 11))
          .foregroundStyle(theme.textSecondary)
          .lineLimit(2)
          .padding(.horizontal, 12)
          .padding(.vertical, 6)
          .frame(maxWidth: .infinity, alignment: .leading)
          .help(turn.prompt)
      }
      content
    }
    .task(id: LoadKey(scope: scoped.scope, generation: workspace.generation)) { await scoped.load() }
  }

  @ViewBuilder
  private var content: some View {
    if let error = scoped.errorMessage {
      QuietEmptyState(icon: "exclamationmark.triangle", title: "Couldn't load the changes", message: error)
    } else if scoped.files.isEmpty && !scoped.isLoading {
      QuietEmptyState(icon: "checkmark.seal", title: "No changes", message: emptyMessage)
    } else {
      FileDiffList(
        files: scoped.files, selected: Binding(get: { scoped.selected }, set: { scoped.selected = $0 }),
        isLoading: scoped.isLoading)
    }
  }

  private var emptyMessage: String {
    switch scoped.scope {
    case .branch: "This branch has no changes since its base."
    default: "This turn didn't change any files."
    }
  }

  private struct LoadKey: Hashable {
    let scope: SessionDiffScope
    let generation: Int
  }
}

/// The picked file's diff in a turn or branch scope; comments on it join the session's review.
struct ScopedDiffPane: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace

  private var scoped: ScopedDiffModel { workspace.scopedDiff }

  var body: some View {
    let current = scoped.files.first { $0.path == scoped.selected }
    DiffPane(
      diff: current?.diff, path: current?.path, isLoading: scoped.isLoading && current == nil,
      openLine: current.flatMap(openLine),
      review: current.map {
        DiffReviewContext.session(
          workspace.sessionId, path: $0.path, scope: scoped.reviewScope, store: model.store)
      })
  }

  /// A deleted file has no lines to open.
  private func openLine(_ file: FileDiff) -> ((Int) -> Void)? {
    guard file.status != .deleted else { return nil }
    return { line in
      model.openCode(session: workspace.sessionId, path: file.path, line: line, source: .diff)
    }
  }
}
