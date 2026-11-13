import ArgusCore
import ArgusUI
import SwiftUI

/// App Settings (⌘,): every field in `docs/app-settings.md`, a section per
/// area in the list on the left, its groups in a centred column on the right.
struct SettingsWindow: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  @State private var host = HostSettingsModel()

  var body: some View {
    HStack(spacing: 0) {
      SettingsNavList().layoutPriority(1)
      Rectangle().fill(theme.border).frame(width: 1).ignoresSafeArea()
      VStack(spacing: 0) {
        FocusedHostBanner()
        // minWidth 0: a wide section (Appearance's cards) must not push the
        // row past the window and shift the list off its edge.
        section(model.settingsTab)
          .frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity)
          .id(model.settingsTab)
      }
      .background(theme.bg.ignoresSafeArea())
    }
    .frame(minWidth: 780, idealWidth: 960, minHeight: 520, idealHeight: 680)
    .navigationTitle(model.settingsTab.title)
    .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
    .environment(host)
    .modifier(RunnerSetupPresenter(window: .settings))
    .onChange(of: model.runnerSetup.revision) { Task { await host.loadRunners() } }
    // Settings that live on a host are the shown host's.
    .task(id: SettingsLoadKey(ready: model.store.connection == .ready, host: model.hosts.focused)) {
      guard model.store.connection == .ready else { return }
      host.backend = model.backend
      await host.load()
    }
  }

  @ViewBuilder private func section(_ tab: SettingsTab) -> some View {
    switch tab {
    case .general: GeneralSettingsTab()
    case .appearance: AppearanceSettingsTab()
    case .accounts: AccountsSettingsTab()
    case .account: AccountSettingsTab()
    case .agents: AgentsSettingsTab()
    case .llm: LLMSettingsTab()
    case .mcp: MCPSettingsTab()
    case .integrations: IntegrationsSettingsTab()
    case .tools: ToolsSettingsTab()
    case .git: GitSettingsTab()
    case .worktrees: WorktreesSettingsTab()
    case .editor: EditorTab()
    case .remote: RemoteSettingsTab()
    case .hosts: HostsSettingsTab()
    case .advanced: AdvancedSettingsTab()
    }
  }
}

/// The sections, as a quiet list down the window's left edge.
private struct SettingsNavList: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 1) {
        // The account is the profile row up top, not a row in the list.
        SettingsProfileNavItem(selected: model.settingsTab == .account) { model.settingsTab = .account }
          .padding(.bottom, 6)
        ForEach(SettingsTab.allCases.filter { $0 != .account }, id: \.self) { tab in
          SettingsNavItem(tab.title, systemImage: tab.systemImage, selected: model.settingsTab == tab) {
            model.settingsTab = tab
          }
        }
      }
      .padding(.horizontal, 8)
      .padding(.vertical, 10)
    }
    .frame(width: TextScale.shared(196))
    .background(theme.sidebar.ignoresSafeArea())
  }
}

enum SettingsTab: String, Hashable, CaseIterable {
  case general, appearance, account, accounts, agents, llm, mcp, integrations, tools, git, worktrees, editor, remote, hosts, advanced

  var title: String {
    switch self {
    case .general: "General"
    case .appearance: "Appearance"
    case .account: "Argus Account"
    case .accounts: "Accounts"
    case .agents: "Agents"
    case .llm: "LLM"
    case .mcp: "MCP"
    case .integrations: "Integrations"
    case .tools: "Tools"
    case .git: "Git"
    case .worktrees: "Worktrees"
    case .editor: "Editor"
    case .remote: "Remote"
    case .hosts: "Hosts"
    case .advanced: "Advanced"
    }
  }

  var systemImage: String {
    switch self {
    case .general: "gearshape"
    case .appearance: "paintpalette"
    case .account: "person.badge.key"
    case .accounts: "person.crop.circle"
    case .agents: "sparkles"
    case .llm: "cpu"
    case .mcp: "server.rack"
    case .integrations: "puzzlepiece.extension"
    case .tools: "wrench.and.screwdriver"
    case .git: "arrow.triangle.branch"
    case .worktrees: "externaldrive"
    case .editor: "chevron.left.forwardslash.chevron.right"
    case .remote: "antenna.radiowaves.left.and.right"
    case .hosts: "desktopcomputer"
    case .advanced: "slider.horizontal.3"
    }
  }
}

private struct SettingsLoadKey: Equatable {
  let ready: Bool
  let host: HostId
}

/// Says whose settings these are while another host is shown.
private struct FocusedHostBanner: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme

  var body: some View {
    if model.hosts.focused != Hosts.local {
      HStack(spacing: 8) {
        Image(systemName: "desktopcomputer")
        Text("Showing \(model.hosts.label(model.hosts.focused))'s settings. Remote access, Argus Account and Hosts are always this Mac's.")
        Spacer()
        Button("Show This Mac") { model.hosts.focus(Hosts.local) }
      }
      .font(.scaled(.callout))
      .padding(.horizontal, 12)
      .padding(.vertical, 6)
      .background(theme.warningSoft)
    }
  }
}
