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
      // The stash list beside the selected stash, split by a hairline.
      ResizableHSplit(key: "git.stashes", leadingMin: 220, leadingIdeal: 320, leadingMax: 460, trailingMin: 320) {
        VStack(spacing: 0) {
          listHeader
          list
        }
        .frame(maxHeight: .infinity)
      } trailing: {
        detail.frame(maxHeight: .infinity)
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
      // The history model doesn't hold the stashes one, so capturing it keeps no cycle.
      stashes.onRevealInHistory = { [history = workspace.history, model] sha in
        model.navigate(.sessionGit(id: sessionId, view: isProjectRoot ? .history : .branch))
        Task {
          await history.loadIfNeeded()
          if let commit = history.commit(withID: sha) { history.select(commit) }
        }
      }
    }
  }

  private var listHeader: some View {
    PanelHeader(title: "Stashes", detail: stashes.stashes.isEmpty ? nil : "\(stashes.stashes.count)") {
      if stashes.isLoading && !stashes.stashes.isEmpty { ProgressView().controlSize(.small) }
      Button {
        GitMenuAction.stash.post(to: workspace.sessionId)
      } label: {
        Label("Stash Changes", systemImage: "plus")
      }
      .buttonStyle(FlatIconButtonStyle(size: 22))
      .disabled(workspace.workingCopy.changedCount == 0)
      .help("Stash Changes…")
      .accessibilityLabel("Stash Changes")
    }
  }

  private var list: some View {
    List(stashes.stashes) { stash in
      VStack(alignment: .leading, spacing: 2) {
        Text(stash.message).lineLimit(2)
        HStack(spacing: 6) {
          Text(Self.ref(stash)).font(.scaled(size: 10, design: .monospaced))
          if let branch = stash.branchName { Label(branch, systemImage: "arrow.triangle.branch") }
          Spacer(minLength: 4)
          Text(stash.date, format: .relative(presentation: .named))
        }
        .font(.scaled(size: 11))
        .foregroundStyle(theme.textSecondary)
        .lineLimit(1)
      }
      .padding(.vertical, 3)
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(.rect)
      .onTapGesture { Task { await stashes.select(stash) } }
      .modifier(NavigatorRowHighlight(selected: stashes.selectedStash?.sha == stash.sha))
      .contextMenu { menu(stash) }
    }
    .navigatorList()
    .overlay {
      if stashes.stashes.isEmpty && !stashes.isLoading {
        QuietEmptyState(icon: "tray", title: "No stashes", message: "Stashed changes show up here.")
      }
    }
  }

  @ViewBuilder
  private var detail: some View {
    if let stash = stashes.selectedStash {
      VStack(spacing: 0) {
        HStack(spacing: 8) {
          Text(stash.message).font(.scaled(size: 12, weight: .medium)).lineLimit(1)
          Spacer()
          Group {
            Button("Apply") { stashes.request(.apply, on: stash) }
            Button("Pop") { stashes.request(.pop, on: stash) }
            Button("Drop", role: .destructive) { stashes.request(.drop, on: stash) }
          }
          .buttonStyle(QuietTabButtonStyle())
          Menu {
            menu(stash)
          } label: {
            Image(systemName: "ellipsis")
          }
          .menuStyle(.button)
          .clickable()
          .buttonStyle(FlatIconButtonStyle(size: 22))
          .menuIndicator(.hidden)
          .fixedSize()
          .accessibilityLabel("More")
        }
        .disabled(stashes.isPerforming)
        .padding(.horizontal, 12)
        .frame(height: 34)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.border).frame(height: 1) }
        FileDiffsView(files: stashes.stashDiffs, isLoading: stashes.isLoadingDiff)
      }
    } else {
      QuietEmptyState(icon: "tray.full", title: "Select a stash")
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
  }

  private func branch(from stash: StashEntry) {
    let workspace = workspace
    GitDialogs.sheet(theme: theme) { dismiss in
      GitNameSheet(
        title: "New Branch from \(Self.ref(stash))", label: "Branch name", primary: "Create",
        validate: RefName.isValid, dismiss: dismiss
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
