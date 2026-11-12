#if os(iOS)
  import ArgusCore
  import SwiftUI

  /// The strip tucked under a phone start composer, as the Mac's: where the
  /// agent works, the runner and Linear issues on the left; the branch it starts
  /// on at the right. The project is picked in the title, as on the Mac.
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
      VStack(alignment: .leading, spacing: 4) {
        if !flow.issues.isEmpty { PickedIssueChips(issues: $flow.issues).padding(.top, 6) }
        // One line with the branch pushed right when it fits; otherwise the pills wrap, never cut off.
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 2) {
            pills
            Spacer(minLength: 4)
            branchPill.fixedSize()
          }
          ChipFlowLayout(spacing: 2, lineSpacing: 0) {
            pills
            branchPill
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
      .padding(.horizontal, 6)
      .padding(.top, 1)
      .frame(minHeight: TextScale.shared(38))
      .background(theme.bgSecondary, in: shape)
      .overlay { shape.strokeBorder(theme.border, lineWidth: 1) }
      // Shares the card's bottom edge rather than doubling it.
      .padding(.top, -1)
      .sheet(item: $picker) { picked($0) }
      .sheet(isPresented: $pickingIssues) { IssuePickerSheet(selection: $flow.issues) }
    }

    /// Where it works, the runner and Linear issues.
    @ViewBuilder
    private var pills: some View {
      if flow.issues.isEmpty, flow.options.count > 1 { workspaceMenu.fixedSize() }
      if !host.runners.isEmpty { runnerPill.fixedSize() }
      if flow.repoRoot != nil, host.linearConnected { issuePill.fixedSize() }
    }

    private var shape: UnevenRoundedRectangle {
      UnevenRoundedRectangle(bottomLeadingRadius: 14, bottomTrailingRadius: 14)
    }

    /// Only the icon until a runner is picked, as the link pill does.
    private var runnerPill: some View {
      Button { picker = .runner } label: {
        ComposerPillLabel(icon: Icon.terminal, title: composer.runner?.displayName, chevron: composer.runner != nil)
      }
      .buttonStyle(.argusPlain)
      .accessibilityLabel("Runner: \(composer.runner?.displayName ?? "Default")")
    }

    private var issuePill: some View {
      Button { pickingIssues = true } label: {
        ComposerPillLabel(icon: Icon.issue, chevron: false)
      }
      .buttonStyle(.argusPlain)
      .accessibilityLabel(flow.issues.isEmpty ? "Linear issue" : "Add issue")
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
      Menu {
        Picker("Workspace", selection: kind) {
          ForEach(flow.options, id: \.self) { option in
            Button {} label: {
              Label(label(option), systemImage: icon(option))
              if let hint = hint(option) { Text(hint) }
            }
            .tag(option)
          }
        }
        .pickerStyle(.inline)
      } label: {
        ComposerPillLabel(icon: icon(flow.workspace.kind), title: label(flow.workspace.kind))
      }
      .menuIndicator(.hidden)
      .accessibilityLabel("Workspace: \(label(flow.workspace.kind))")
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
    private var branchPill: some View {
      switch flow.chosen {
      case .current:
        if let branch = flow.sessionId.flatMap(host.session(id:))?.branch {
          ComposerPillLabel(icon: Icon.branch, title: branch, chevron: false)
        }
      case .worktree:
        Button { picker = .base } label: {
          ComposerPillLabel(icon: Icon.branch, title: flow.workspace.baseTitle)
        }
        .buttonStyle(.argusPlain)
        .accessibilityLabel("Base branch: \(flow.workspace.base ?? "Project default")")
      case .existing:
        Button { picker = .existing } label: {
          ComposerPillLabel(
            icon: Icon.branch, title: flow.workspace.existingBranch ?? "Pick a branch",
            accent: flow.workspace.existingBranch == nil)
        }
        .buttonStyle(.argusPlain)
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
            + host.runners.map {
              .init(value: $0.id, label: $0.displayName, hint: $0.pickerHint, disabled: !$0.isAvailable)
            },
          selected: [composer.runner?.id ?? ""]
        ) { id in
          composer.setRunner(host.runners.first { $0.id == id })
        }
      }
    }
  }
#endif
