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
        if capabilities.models.isEmpty {
          ChromeMenuEntry.note("This agent hasn't reported its models yet.")
        } else {
          ChromeMenuEntry.header("Model")
          for model in capabilities.models {
            ChromeMenuItem(model.displayName, subtitle: model.description, checked: model.value == status?.model) {
              Task { await host.setModel(agentId: agentId, model: model.value) }
            }
          }
        }
        if sessionId != nil, (host.claudeAccounts?.count ?? 0) > 1 {
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
      .buttonStyle(.plain)
      .fixedSize()
      .help("Switch model")
    }

    private var permissionMenu: some View {
      ChromeMenuButton(edge: .above) {
        for mode in RemotePermissionMode.allCases {
          ChromeMenuItem(ComposerPermissionMode.label(mode), checked: mode == permissionMode) {
            Task { await host.setPermissionMode(agentId: agentId, mode: mode) }
          }
        }
      } label: { open in
        ComposerPillLabel(
          icon: Icon.lock, title: ComposerPermissionMode.label(permissionMode), accent: permissionMode != .auto,
          open: open)
      }
      .buttonStyle(.plain)
      .fixedSize()
      .help("\(ComposerPermissionMode.description(permissionMode)) (⇧Tab to cycle)")
    }

    private var effortMenu: some View {
      ChromeMenuButton(edge: .above) {
        for level in [String?.none] + effortLevels.map(Optional.some) {
          ChromeMenuItem(ComposerEffort.label(level), checked: level == host.effortByAgent[agentId]) {
            Task { await host.setEffort(agentId: agentId, level: level) }
          }
        }
      } label: { open in
        ComposerPillLabel(icon: Icon.clock, title: ComposerEffort.label(host.effortByAgent[agentId]), open: open)
      }
      .buttonStyle(.plain)
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
      .buttonStyle(.plain)
      .fixedSize()
      .help(linkedProjects.isEmpty ? "Link another project to this message" : "Projects linked to this message")
      .accessibilityLabel("Link other project")
    }

    // MARK: State

    var permissionMode: RemotePermissionMode {
      ComposerPermissionMode.canonical(status?.permissionMode)
    }

    private var currentModel: RemoteModelInfo? {
      capabilities.models.first { $0.value == status?.model } ?? capabilities.models.first
    }

    var effortLevels: [String] { ComposerEffort.levels(for: currentModel) }

    private var modelLabel: String {
      guard let value = status?.model else { return "Model" }
      return capabilities.models.first { $0.value == value }?.displayName ?? value
    }

    private var linkableProjects: [RemoteProject] {
      let own = sessionId.flatMap { host.repoRoot(forSessionId: $0) }
      return host.projects.filter { $0.repoRoot != own }
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
