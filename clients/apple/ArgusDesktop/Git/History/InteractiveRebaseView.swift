import ArgusUI
import GroveKit
import SwiftUI

/// Plans an interactive rebase of HEAD's commits above `from`: an action per
/// commit, drag to reorder, new messages for rewords.
struct InteractiveRebaseView: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let from: String
  @State private var planner: InteractiveRebaseViewModel?
  @State private var problem: String?
  @State private var running = false
  private var history: HistoryViewModel { workspace.history }

  var body: some View {
    Group {
      if let planner {
        editor(planner)
      } else if let problem {
        EmptyState(icon: "list.bullet.indent", title: "Can't rebase from here", body: problem) {
          Button("Back to History") { navigate(.history) }
        }
      } else {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .task(id: from) { await resolve() }
  }

  private func editor(_ planner: InteractiveRebaseViewModel) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Interactive Rebase").font(.scaled(size: 13, weight: .semibold))
        Text(
          "Replays \(planner.steps.count) commit\(planner.steps.count == 1 ? "" : "s") onto \(planner.base.shortSHA) "
            + "\u{201C}\(planner.base.summary)\u{201D}. Newest first; drag to reorder. Squash and fixup fold into the commit below."
        )
        .font(.scaled(size: 12)).foregroundStyle(.secondary)
      }
      .padding(12)
      Divider()
      List {
        ForEach(planner.steps) { step in
          RebaseStepRow(
            step: step, commit: planner.commit(for: step),
            onAction: { planner.setAction($0, for: step) },
            onMessage: { planner.setMessage($0, for: step) })
        }
        .onMove { planner.move(fromOffsets: $0, toOffset: $1) }
      }
      .listStyle(.inset)
      Divider()
      VStack(alignment: .leading, spacing: 8) {
        if let problem = planner.problem {
          SheetBanner(message: problem, tone: .danger)
        } else if let warning = history.pushedWarning(for: planner.steps.compactMap { planner.commit(for: $0) }) {
          SheetBanner(message: warning, tone: .warning)
        }
        if let error = history.errorMessage { SheetBanner(message: error, tone: .danger) }
        HStack {
          Text(planner.summary).font(.scaled(size: 11, design: .monospaced)).foregroundStyle(.secondary)
          if running { ProgressView().controlSize(.small) }
          Spacer()
          Button("Cancel") { navigate(.history) }.keyboardShortcut(.cancelAction)
          Button("Start Rebase") { Task { await start(planner) } }
            .keyboardShortcut(.defaultAction)
            .disabled(planner.problem != nil || planner.isUnchanged || running)
        }
      }
      .padding(12)
    }
  }

  private func resolve() async {
    planner = nil
    problem = nil
    history.dismissError()
    guard let base = try? await workspace.repository.commitDetail(from) else {
      return problem = "Couldn't find commit \(from.prefix(7))."
    }
    await history.loadIfNeeded()
    // Rebase candidates are read from the loaded log, so page the base in.
    if history.commit(withID: base.id) == nil { await history.selectCommit(id: base.id) }
    guard let commits = history.rebaseCandidates(onto: base), !commits.isEmpty else {
      return problem = "\(base.shortSHA) has to be on the checked-out branch's first-parent line, below HEAD, with no merges above it."
    }
    planner = InteractiveRebaseViewModel(base: base, commits: commits)
  }

  private func start(_ planner: InteractiveRebaseViewModel) async {
    running = true
    defer { running = false }
    history.dismissError()
    await history.rebaseInteractively(onto: planner.base, plan: planner.plan)
    if workspace.repository.repositoryState != .normal {
      navigate(.conflicts)
    } else if history.errorMessage == nil {
      navigate(.history)
    }
  }

  private func navigate(_ route: GitRoute) {
    model.navigate(.sessionGit(id: workspace.sessionId, view: route))
  }
}

/// One commit in the plan: handle, action, the commit, and a message editor for rewords.
private struct RebaseStepRow: View {
  @Environment(\.theme) private var theme
  let step: RebaseStep
  let commit: CommitInfo?
  let onAction: (RebaseAction) -> Void
  let onMessage: (String) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Image(systemName: "line.3.horizontal").foregroundStyle(.secondary).accessibilityHidden(true)
        Picker("Action", selection: Binding(get: { step.action }, set: { onAction($0) })) {
          ForEach(RebaseAction.allCases) { Text($0.title).tag($0) }
        }
        .labelsHidden()
        .fixedSize()
        .accessibilityLabel("Action for \(commit?.summary ?? step.sha)")
        if step.action.foldsIntoPrevious {
          Image(systemName: "arrow.turn.left.down").foregroundStyle(.secondary).help("Folds into the commit below")
        }
        Text(commit?.summary ?? step.sha)
          .strikethrough(step.action == .drop)
          .foregroundStyle(step.action == .drop ? .secondary : .primary)
          .lineLimit(1)
        Spacer()
        Text(String(step.sha.prefix(7))).font(.scaled(size: 11, design: .monospaced)).foregroundStyle(.secondary)
      }
      .font(.scaled(size: 12))
      if step.action == .reword {
        TextEditor(text: Binding(get: { step.message ?? "" }, set: { onMessage($0) }))
          .font(.scaled(size: 12))
          .frame(height: 64)
          .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.border))
          .accessibilityLabel("New message")
      }
    }
    .padding(.vertical, 3)
  }
}
