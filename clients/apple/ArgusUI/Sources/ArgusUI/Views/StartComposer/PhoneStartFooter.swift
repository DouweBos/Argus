#if os(iOS)
  import ArgusCore
  import SwiftUI

  /// The strip under a phone start composer, as the Mac's: where the agent
  /// works and the branch it starts on, then the phone's runner and Linear
  /// issue chips. Only what applies shows.
  struct PhoneStartFooter: View {
    private enum Sheet: String, Identifiable {
      case base, existing, runner
      var id: String { rawValue }
    }

    @Environment(\.theme) private var theme
    @Environment(HostStore.self) private var host
    @Bindable var flow: PhoneAgentStart
    let composer: ComposerModel
    @State private var picker: Sheet?
    @State private var pickingIssues = false

    var body: some View {
      VStack(alignment: .leading, spacing: 6) {
        if !flow.issues.isEmpty { PickedIssueChips(issues: $flow.issues) }
        ChipFlowLayout(spacing: 6, lineSpacing: 6) {
          if flow.issues.isEmpty, flow.options.count > 1 { workspaceMenu }
          branchChip
          if !host.runners.isEmpty {
            Chip(label: composer.runner?.displayName ?? "Default runner", icon: Icon.terminal) { picker = .runner }
              .accessibilityLabel("Runner: \(composer.runner?.displayName ?? "Default")")
          }
          if flow.repoRoot != nil, host.linearConnected {
            Chip(label: flow.issues.isEmpty ? "Linear issue" : "Add issue", icon: Icon.issue) { pickingIssues = true }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .sheet(item: $picker) { picked($0) }
      .sheet(isPresented: $pickingIssues) { IssuePickerSheet(selection: $flow.issues) }
    }

    private var currentLabel: String {
      StartWorkspace.currentLabel(for: flow.sessionId.flatMap(host.session(id:))?.kind)
    }

    private func label(_ kind: StartWorkspace.Kind) -> String {
      switch kind {
      case .current: currentLabel
      case .worktree: StartWorkspace.worktreeLabel
      case .existing: StartWorkspace.existingLabel
      }
    }

    private func icon(_ kind: StartWorkspace.Kind) -> String {
      kind == .worktree ? "folder.badge.plus" : kind == .existing ? Icon.branch : Icon.folder
    }

    private var workspaceMenu: some View {
      MenuChip(
        "Workspace", selection: kind,
        options: flow.options.map { .init(value: $0, label: label($0), hint: hint($0)) },
        icon: icon(flow.workspace.kind))
    }

    private var kind: Binding<StartWorkspace.Kind> {
      Binding(get: { flow.workspace.kind }, set: { flow.workspace.kind = $0 })
    }

    private func hint(_ kind: StartWorkspace.Kind) -> String? {
      switch kind {
      case .current: flow.sessionId.flatMap(host.session(id:))?.branch
      case .worktree: StartWorkspace.worktreeHint
      case .existing: "Check out a branch in a new worktree"
      }
    }

    @ViewBuilder
    private var branchChip: some View {
      switch flow.chosen {
      case .current:
        if let branch = flow.sessionId.flatMap(host.session(id:))?.branch {
          Chip(label: branch, icon: Icon.branch, mono: true)
        }
      case .worktree:
        Chip(label: flow.workspace.baseTitle, icon: Icon.branch) { picker = .base }
          .accessibilityLabel("Base branch: \(flow.workspace.base ?? "Project default")")
      case .existing:
        Chip(
          label: flow.workspace.existingBranch ?? "Pick a branch", icon: Icon.branch,
          tone: flow.workspace.existingBranch == nil ? .accent : nil
        ) { picker = .existing }
      }
    }

    /// The session's branches; with no session, the project's local ones.
    private var branchOptions: [PickerSheet<String>.Option] {
      guard !flow.branches.isEmpty else {
        return flow.workspace.bases.options.filter { !$0.hasPrefix("origin/") }.map { .init(value: $0, label: $0) }
      }
      return flow.branches.map {
        .init(value: $0.name, label: $0.name, hint: $0.scope == .remote ? "remote" : $0.lastCommitSubject)
      }
    }

    /// The project's base candidates; a host too old to list them offers the session's branches.
    private var baseOptions: [PickerSheet<String>.Option] {
      let bases = flow.workspace.bases.options
      guard bases.isEmpty else { return bases.map { .init(value: $0, label: $0) } }
      return flow.branches.map { .init(value: $0.name, label: $0.name) }
    }

    @ViewBuilder
    private func picked(_ which: Sheet) -> some View {
      switch which {
      case .base:
        PickerSheet(
          title: "Base branch", options: baseOptions, selected: Set([flow.workspace.base].compactMap { $0 }),
          emptyMessage: "This project reported no branches."
        ) { flow.workspace.bases.picked = $0 }
      case .existing:
        PickerSheet(
          title: "Existing branch", options: branchOptions,
          selected: Set([flow.workspace.existingBranch].compactMap { $0 }),
          emptyMessage: "This project reported no branches."
        ) { flow.workspace.existingBranch = $0 }
      case .runner:
        PickerSheet(
          title: "Runner",
          options: [.init(value: "", label: "Default", hint: "Use the computer's default")]
            + host.runners.map { .init(value: $0.id, label: $0.displayName, hint: $0.isCustom ? "Custom" : nil) },
          selected: [composer.runner?.id ?? ""]
        ) { id in
          composer.setRunner(host.runners.first { $0.id == id })
        }
      }
    }
  }
#endif
