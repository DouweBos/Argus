#if os(macOS)
  import ArgusCore
  import SwiftUI

  /// The row under the input: context, model (and account), permission mode,
  /// effort and linked projects — each a native menu over the agent's state.
  extension MacChatInputView {
    var controlRow: some View {
      HStack(spacing: 6) {
        if contextTokens > 0 {
          ContextMeter(
            tokens: contextTokens,
            limit: status?.contextWindow
              ?? ContextWindow.limit(forModel: status?.model, capabilities: capabilities))
        }
        modelMenu
        permissionMenu
        if !effortLevels.isEmpty { effortMenu }
        projectMenu
        Spacer(minLength: 0)
      }
      .disabled(!isEnabled)
    }

    private var modelMenu: some View {
      Menu {
        modelOptions
        if sessionId != nil, (host.claudeAccounts?.count ?? 0) > 1 {
          Divider()
          Picker("Account", selection: accountBinding) {
            Text("Follow computer default").tag(Self.followDefaultAccount)
            ForEach(host.claudeAccounts ?? [], id: \.id) { account in
              Text(account.displayName).tag(account.id)
            }
          }
          .pickerStyle(.inline)
        }
      } label: {
        Chip(label: modelLabel, icon: Icon.agent)
      }
      .chipMenu()
      .help("Switch model")
      .popover(isPresented: $showingModelPopover, arrowEdge: .top) {
        ModelPopover(
          models: capabilities.models, selected: status?.model
        ) { value in
          showingModelPopover = false
          Task { await host.setModel(agentId: agentId, model: value) }
        }
      }
    }

    @ViewBuilder private var modelOptions: some View {
      if capabilities.models.isEmpty {
        Text("This agent hasn't reported its models yet.")
      } else {
        Picker("Switch model", selection: modelBinding) {
          ForEach(capabilities.models) { model in
            Text(model.displayName).tag(model.value)
          }
        }
        .pickerStyle(.inline)
      }
    }

    private var permissionMenu: some View {
      Menu {
        Picker("Permission mode", selection: permissionBinding) {
          ForEach(RemotePermissionMode.allCases, id: \.self) { mode in
            Text(ComposerPermissionMode.label(mode)).tag(mode)
          }
        }
        .pickerStyle(.inline)
      } label: {
        Chip(
          label: ComposerPermissionMode.label(permissionMode), icon: Icon.lock,
          tone: permissionMode == .auto ? nil : .accent)
      }
      .chipMenu()
      .help("\(ComposerPermissionMode.description(permissionMode)) (⇧Tab to cycle)")
    }

    private var effortMenu: some View {
      Menu {
        Picker("Reasoning effort", selection: effortBinding) {
          Text(ComposerEffort.label(nil)).tag(String?.none)
          ForEach(effortLevels, id: \.self) { level in
            Text(ComposerEffort.label(level)).tag(String?.some(level))
          }
        }
        .pickerStyle(.inline)
      } label: {
        Chip(label: ComposerEffort.label(host.effortByAgent[agentId]), icon: Icon.clock)
      }
      .chipMenu()
      .help("Reasoning effort")
    }

    private var projectMenu: some View {
      Menu {
        if linkableProjects.isEmpty {
          Text("No other projects")
        }
        ForEach(linkableProjects) { project in
          Toggle(project.name, isOn: linkBinding(project.repoRoot))
        }
      } label: {
        Chip(
          label: linkedProjects.isEmpty ? "Link other project" : "\(linkedProjects.count) linked",
          icon: Icon.link, tone: linkedProjects.isEmpty ? nil : .accent)
      }
      .chipMenu()
      .help("Give the agent another project for this message")
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

    private var modelBinding: Binding<String> {
      Binding(
        get: { status?.model ?? "" },
        set: { value in Task { await host.setModel(agentId: agentId, model: value) } })
    }

    private var permissionBinding: Binding<RemotePermissionMode> {
      Binding(
        get: { permissionMode },
        set: { mode in Task { await host.setPermissionMode(agentId: agentId, mode: mode) } })
    }

    private var effortBinding: Binding<String?> {
      Binding(
        get: { host.effortByAgent[agentId] },
        set: { level in Task { await host.setEffort(agentId: agentId, level: level) } })
    }

    private var accountBinding: Binding<String> {
      Binding(
        get: {
          sessionId.flatMap { host.claudeAccountId(forSessionId: $0) } ?? Self.followDefaultAccount
        },
        set: { value in
          guard let sessionId else { return }
          Task {
            await host.setSessionClaudeAccount(
              sessionId: sessionId, accountId: value == Self.followDefaultAccount ? nil : value,
              agentId: agentId)
          }
        })
    }

    private func linkBinding(_ repoRoot: String) -> Binding<Bool> {
      Binding(
        get: { linkedProjects.contains(repoRoot) },
        set: { on in
          linkedProjects.removeAll { $0 == repoRoot }
          if on { linkedProjects.append(repoRoot) }
          preferences.encode(linkedProjects, for: PreferenceKey.linkedProjects(agentId: agentId))
        })
    }
  }

  extension View {
    /// A menu whose label is a chip rather than a bezelled pop-up button.
    fileprivate func chipMenu() -> some View {
      menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
    }
  }

  /// `/model` with no argument opens this, as it opens the picker on the desktop.
  private struct ModelPopover: View {
    @Environment(\.theme) private var theme
    let models: [RemoteModelInfo]
    let selected: String?
    let pick: (String) -> Void

    var body: some View {
      VStack(alignment: .leading, spacing: 2) {
        Text("Switch model")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(theme.textMuted)
          .padding(.horizontal, 8)
        if models.isEmpty {
          Text("This agent hasn't reported its models yet.")
            .foregroundStyle(theme.textMuted)
            .padding(8)
        }
        ForEach(models) { model in
          Button {
            pick(model.value)
          } label: {
            HStack {
              VStack(alignment: .leading, spacing: 1) {
                Text(model.displayName).foregroundStyle(theme.text)
                if !model.description.isEmpty {
                  Text(model.description)
                    .font(.system(size: 11))
                    .foregroundStyle(theme.textMuted)
                    .lineLimit(1)
                }
              }
              Spacer(minLength: 12)
              if model.value == selected {
                Image(systemName: Icon.check).foregroundStyle(theme.accent)
              }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
      }
      .padding(.vertical, 8)
      .frame(minWidth: 260)
    }
  }
#endif
