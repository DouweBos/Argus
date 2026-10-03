import ArgusUI
import GroveKit
import SwiftUI

/// The stash list beside the selected stash's changes; apply, pop, drop,
/// branch from it, or find the commit it was made on.
struct StashesView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace

  private var stashes: StashesViewModel { workspace.stashes }

  var body: some View {
    VStack(spacing: 0) {
      if let error = stashes.errorMessage {
        GitErrorBanner(message: error) { stashes.dismissError() }
      }
      HSplitView {
        list.frame(minWidth: 220, idealWidth: 260, maxWidth: 460, maxHeight: .infinity)
        detail.frame(minWidth: 420, maxHeight: .infinity)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .alert(
      stashes.pendingOperation.map { "\($0.operation.title) \(Self.ref($0.stash))?" } ?? "",
      isPresented: Binding(
        get: { stashes.pendingOperation != nil }, set: { if !$0 { stashes.cancelPendingOperation() } }),
      presenting: stashes.pendingOperation
    ) { pending in
      Button(pending.operation.title, role: pending.operation == .drop ? .destructive : nil) {
        Task { await perform(pending) }
      }
      Button("Cancel", role: .cancel) { stashes.cancelPendingOperation() }
    } message: { pending in
      Text(Self.explanation(pending.operation))
    }
    .task {
      let sessionId = workspace.sessionId
      let isProjectRoot = workspace.isProjectRoot
      stashes.onRevealInHistory = { [weak workspace, model] sha in
        model.navigate(.sessionGit(id: sessionId, view: isProjectRoot ? .history : .branch))
        Task {
          guard let history = workspace?.history else { return }
          await history.loadIfNeeded()
          if let commit = history.commit(withID: sha) { history.select(commit) }
        }
      }
    }
  }

  private var list: some View {
    List(
      stashes.stashes,
      selection: Binding(
        get: { stashes.selectedStash?.sha },
        set: { sha in
          guard let stash = stashes.stashes.first(where: { $0.sha == sha }) else { return }
          Task { await stashes.select(stash) }
        })
    ) { stash in
      VStack(alignment: .leading, spacing: 2) {
        Text(stash.message).lineLimit(2)
        HStack(spacing: 6) {
          Text(Self.ref(stash)).font(.system(size: 10, design: .monospaced))
          if let branch = stash.branchName { Label(branch, systemImage: "arrow.triangle.branch") }
          Spacer(minLength: 4)
          Text(stash.date, format: .relative(presentation: .named))
        }
        .font(.system(size: 11))
        .foregroundStyle(theme.textSecondary)
        .lineLimit(1)
      }
      .padding(.vertical, 2)
      .tag(stash.sha)
      .contextMenu { menu(stash) }
    }
    .overlay {
      if stashes.stashes.isEmpty && !stashes.isLoading {
        ContentUnavailableView("No Stashes", systemImage: "tray", description: Text("Stashed changes show up here."))
      }
    }
  }

  @ViewBuilder
  private var detail: some View {
    if let stash = stashes.selectedStash {
      VStack(spacing: 0) {
        HStack(spacing: 8) {
          Text(stash.message).font(.headline).lineLimit(1)
          Spacer()
          Button("Apply") { stashes.request(.apply, on: stash) }
          Button("Pop") { stashes.request(.pop, on: stash) }
          Button("Drop", role: .destructive) { stashes.request(.drop, on: stash) }
          Menu {
            menu(stash)
          } label: {
            Image(systemName: "ellipsis.circle")
          }
          .menuIndicator(.hidden)
          .fixedSize()
          .accessibilityLabel("More")
        }
        .disabled(stashes.isPerforming)
        .controlSize(.small)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        Divider()
        FileDiffsView(files: stashes.stashDiffs, isLoading: stashes.isLoadingDiff)
      }
    } else {
      ContentUnavailableView("Select a Stash", systemImage: "tray.full")
    }
  }

  @ViewBuilder
  private func menu(_ stash: StashEntry) -> some View {
    Button("Apply") { stashes.request(.apply, on: stash) }
    Button("Pop") { stashes.request(.pop, on: stash) }
    Button("New Branch from Stash…") { branch(from: stash) }
    Button("Reveal Base in History") { Task { await stashes.revealBaseInHistory(stash) } }
    Button("Copy Message") { Clipboard.copy(stash.message) }
    Divider()
    Button("Drop…", role: .destructive) { stashes.request(.drop, on: stash) }
  }

  private func perform(_ pending: StashesViewModel.PendingOperation) async {
    stashes.dismissError()
    await stashes.confirm(pending)
    let action: MacTelemetryEvent.GitAction =
      switch pending.operation {
      case .apply: .stashApply
      case .pop: .stashPop
      case .drop: .stashDrop
      }
    workspace.track(action, success: stashes.errorMessage == nil)
  }

  private func branch(from stash: StashEntry) {
    let workspace = workspace
    GitDialogs.sheet(theme: theme) { dismiss in
      GitNameSheet(
        title: "New Branch from \(Self.ref(stash))", label: "Branch name", primary: "Create",
        validate: GitNameSheet.isValidRef, dismiss: dismiss
      ) { name, _ in
        Task {
          await workspace.host(
            GitCommands.GitStashBranch.self,
            .init(id: workspace.sessionId, stashRef: Self.ref(stash), branchName: name),
            label: "Creating \(name)…", track: .branchCreate)
        }
      }
    }
  }

  private static func ref(_ stash: StashEntry) -> String { "stash@{\(stash.id)}" }

  private static func explanation(_ operation: StashesViewModel.Operation) -> String {
    switch operation {
    case .apply: "Its changes are applied to the working copy; the stash is kept."
    case .pop: "Its changes are applied to the working copy and the stash is removed."
    case .drop: "The stash is deleted for good."
    }
  }
}
