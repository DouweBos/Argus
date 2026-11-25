import ArgusCore
import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI

/// The working copy, from GroveUIKit, with Argus's own parts in its slots: the diff scope, the review-aware
/// diff, Claude's draft and Review beside Commit, and File History and Blame in a row's menu.
struct WorkingCopyView: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let session: RemoteSession
  /// File history lives in the history view; nil leaves the menu item out.
  var onShowFileHistory: ((String) -> Void)? = nil
  @AppStorage("git.changes.leftWidth") private var leftWidth: Double = 360
  @State private var managingTemplates = false

  private var vm: WorkingCopyViewModel { workspace.workingCopy }

  var body: some View {
    VStack(spacing: 0) {
      WorkingCopyErrorBanner(workspace: workspace)
      GitWorkingCopyView(viewModel: vm, host: host, slots: slots)
        .gitPanelPadding()
    }
    .gitFeatures(workspace.features)
    .argusSheet(isPresented: $managingTemplates) { CommitTemplatesSheet(store: CommitPreferences.templates) }
    .onChange(of: workspace.suppressLfsWarning, initial: true) { _, suppressed in
      if suppressed { vm.dismissLFSWarning() }
    }
  }

  private var host: GitWorkingCopyHost {
    var host = GitWorkingCopyHost.argus(workspace: workspace, session: session, model: model)
    host.manageTemplates = { managingTemplates = true }
    host.leftWidth = $leftWidth
    return host
  }

  private var slots: GitWorkingCopySlots {
    var slots = GitWorkingCopySlots.argus(workspace: workspace, onShowFileHistory: onShowFileHistory)
    slots.composerAccessory = AnyView(CommitDraftAndReview(workspace: workspace))
    return slots
  }
}

/// The view model's last failure, typed for the banner's fixes where the host said what went wrong.
struct WorkingCopyErrorBanner: View {
  let workspace: GitWorkspace

  var body: some View {
    let vm = workspace.workingCopy
    if let error = vm.errorMessage {
      let typed = workspace.isRemote ? RemoteGitFailures.shared.recent(sessionId: workspace.sessionId) : nil
      GitFailureBanner(
        workspace: workspace, session: nil,
        failure: typed.map { GitFailure(kind: $0.kind, message: error, recovery: $0.recovery, details: $0.details) }
          ?? GitFailure.classify(error),
        canRetry: false
      ) { vm.clearError() }
    }
  }
}

/// Claude's draft of the message for the staged changes (⌥⌘G), and a review by a new agent.
private struct CommitDraftAndReview: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  @State private var drafting = false

  private var vm: WorkingCopyViewModel { workspace.workingCopy }

  var body: some View {
    Button(action: draft) {
      if drafting {
        ProgressView().controlSize(.small)
      } else {
        Image(systemName: "sparkles")
      }
    }
    .buttonStyle(FlatIconButtonStyle(size: 26))
    .keyboardShortcut("g", modifiers: [.command, .option])
    .disabled(drafting || vm.stagedFiles.isEmpty)
    .help(vm.stagedFiles.isEmpty ? "Stage changes to draft a message" : "Draft a message with Claude (⌥⌘G)")
    .accessibilityLabel("Draft commit message")
    Button("Review") { Task { await model.requestCodeReview(session: workspace.sessionId) } }
      .buttonStyle(.secondary)
      .disabled(vm.changedCount == 0 && workspace.isProjectRoot)
      .help("Ask a new agent to review these changes before you commit")
  }

  private func draft() {
    guard !drafting, !vm.stagedFiles.isEmpty else { return }
    drafting = true
    Task {
      await workspace.draftCommitMessage()
      drafting = false
    }
  }
}
