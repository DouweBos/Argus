#if os(macOS)
  import ArgusCore
  import SwiftUI

  /// The pills along the composer's foot: model (and account), effort,
  /// permission mode and linked projects — each a dropdown over the agent's state.
  extension MacChatInputView {
    var controlRow: some View {
      // Wraps instead of growing: a fixed-size row widened the middle column
      // and squeezed the sidebar.
      ChipFlowLayout(spacing: 2) {
        modelMenu
        if !effortLevels.isEmpty {
          ComposerPillDivider()
          effortMenu
        }
        ComposerPillDivider()
        permissionMenu
        ComposerPillDivider()
        projectMenu
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .disabled(!isEnabled)
    }

    private var modelMenu: some View {
      ChromeMenuButton(isPresented: $showingModelMenu, edge: .above) {
        if models.isEmpty {
          ChromeMenuEntry.note("No agent has reported its models yet.")
        } else {
          ChromeMenuEntry.header("Model")
          for model in models {
            ChromeMenuItem(model.displayName, subtitle: model.description, checked: model.value == (pickedModel ?? "default")) {
              setModel(model.value)
            }
          }
        }
        if starter == nil, sessionId != nil, (host.claudeAccounts?.count ?? 0) > 1 {
          ChromeMenuEntry.divider
          ChromeMenuEntry.header("Account")
          ChromeMenuItem("Follow computer default", checked: accountId == Self.followDefaultAccount) {
            setAccount(Self.followDefaultAccount)
          }
          for account in host.claudeAccounts ?? [] {
            ChromeMenuItem(account.displayName, icon: .symbol(Icon.person), checked: accountId == account.id) {
              setAccount(account.id)
            }
          }
        }
      } label: { open in
        ComposerPillLabel(icon: Icon.agent, title: modelLabel, open: open)
      }
      .buttonStyle(.argusPlain)
      .fixedSize()
      .help("Switch model")
    }

    private var permissionMenu: some View {
      ChromeMenuButton(edge: .above) {
        for mode in RemotePermissionMode.allCases {
          ChromeMenuItem(ComposerPermissionMode.label(mode), checked: mode == permissionMode) {
            setPermissionMode(mode)
          }
        }
      } label: { open in
        ComposerPillLabel(
          icon: Icon.lock, title: ComposerPermissionMode.label(permissionMode), accent: permissionMode != .auto,
          open: open)
      }
      .buttonStyle(.argusPlain)
      .fixedSize()
      .help("\(ComposerPermissionMode.description(permissionMode)) (⇧Tab to cycle)")
    }

    private var effortMenu: some View {
      ChromeMenuButton(edge: .above) {
        for level in [String?.none] + effortLevels.map(Optional.some) {
          ChromeMenuItem(ComposerEffort.label(level), checked: level == effort) {
            setEffort(level)
          }
        }
      } label: { open in
        ComposerPillLabel(icon: Icon.clock, title: ComposerEffort.label(effort), open: open)
      }
      .buttonStyle(.argusPlain)
      .fixedSize()
      .help("Reasoning effort")
    }

    private var projectMenu: some View {
      ChromeMenuButton(edge: .above) {
        if linkableProjects.isEmpty {
          ChromeMenuEntry.note("No other projects")
        }
        for project in linkableProjects {
          ChromeMenuItem(
            project.name, icon: .badge(project.name, key: project.repoRoot), checked: linkedProjects.contains(project.repoRoot),
            keepsOpen: true
          ) {
            toggleLink(project.repoRoot)
          }
        }
      } label: { open in
        ComposerPillLabel(
          icon: Icon.link, title: linkedProjects.isEmpty ? nil : "\(linkedProjects.count) linked",
          accent: !linkedProjects.isEmpty, chevron: !linkedProjects.isEmpty, open: open)
      }
      .buttonStyle(.argusPlain)
      .fixedSize()
      .help(linkedProjects.isEmpty ? "Link another project to this message" : "Projects linked to this message")
      .accessibilityLabel("Link other project")
    }

    // MARK: State

    var permissionMode: RemotePermissionMode {
      if let starter { return draftMode ?? ComposerPermissionMode.canonical(starter.defaultMode) }
      return ComposerPermissionMode.canonical(status?.permissionMode)
    }

    /// This agent's models; with no agent yet (or none reported), any agent's on the computer.
    private var models: [RemoteModelInfo] {
      ComposerOptions.models(own: capabilities.models, byAgent: host.capabilitiesByAgent)
    }

    /// The model picked for the agent; nil is the CLI default.
    private var pickedModel: String? {
      if let starter { return draftModel ?? starter.defaultModel }
      return status?.model
    }

    private var currentModel: RemoteModelInfo? { ComposerOptions.current(pickedModel, in: models) }

    var effortLevels: [String] { ComposerEffort.levels(for: currentModel) }

    private var effort: String? { starter != nil ? draftEffort : host.effortByAgent[agentId] }

    private var modelLabel: String {
      ModelName.label(for: pickedModel, in: models) ?? "Model"
    }

    private func setModel(_ value: String) {
      if starter != nil {
        draftModel = value
        // Effort levels are per model.
        draftEffort = nil
      } else {
        Task { await host.setModel(agentId: agentId, model: value) }
      }
    }

    private func setEffort(_ level: String?) {
      if starter != nil {
        draftEffort = level
      } else {
        Task { await host.setEffort(agentId: agentId, level: level) }
      }
    }

    private var linkableProjects: [RemoteProject] {
      ComposerOptions.linkable(host.projects, ownRepoRoot: sessionId.flatMap { host.repoRoot(forSessionId: $0) })
    }

    var contextTokens: Int {
      let messages = host.visibleMessages(for: agentId)
      guard let usage = messages.reversed().first(where: { $0.usage != nil })?.usage else {
        return 0
      }
      return ContextWindow.tokensInContext(usage)
    }

    private static let followDefaultAccount = ""

    private var accountId: String {
      sessionId.flatMap { host.claudeAccountId(forSessionId: $0) } ?? Self.followDefaultAccount
    }

    private func setAccount(_ value: String) {
      guard let sessionId else { return }
      Task {
        await host.setSessionClaudeAccount(
          sessionId: sessionId, accountId: value == Self.followDefaultAccount ? nil : value, agentId: agentId)
      }
    }

    private func toggleLink(_ repoRoot: String) {
      let on = !linkedProjects.contains(repoRoot)
      linkedProjects.removeAll { $0 == repoRoot }
      if on { linkedProjects.append(repoRoot) }
      preferences.encode(linkedProjects, for: PreferenceKey.linkedProjects(agentId: agentId))
    }
  }
#endif
