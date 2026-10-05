import ArgusCore
import SwiftUI

/// App Settings (⌘,): every field in `docs/app-settings.md`, one tab per area.
struct SettingsWindow: View {
  @Environment(DesktopModel.self) private var model
  @State private var host = HostSettingsModel()

  var body: some View {
    @Bindable var model = model
    TabView(selection: $model.settingsTab) {
      Tab("General", systemImage: "gearshape", value: SettingsTab.general) { GeneralSettingsTab() }
      Tab("Accounts", systemImage: "person.crop.circle", value: SettingsTab.accounts) {
        AccountsSettingsTab()
      }
      Tab("Agents", systemImage: "sparkles", value: SettingsTab.agents) { AgentsSettingsTab() }
      Tab("LLM", systemImage: "cpu", value: SettingsTab.llm) { LLMSettingsTab() }
      Tab("MCP", systemImage: "server.rack", value: SettingsTab.mcp) { MCPSettingsTab() }
      Tab("Tools", systemImage: "wrench.and.screwdriver", value: SettingsTab.tools) {
        ToolsSettingsTab()
      }
      Tab("Git", systemImage: "arrow.triangle.branch", value: SettingsTab.git) { GitSettingsTab() }
      Tab("Remote", systemImage: "antenna.radiowaves.left.and.right", value: SettingsTab.remote) {
        RemoteSettingsTab()
      }
      Tab("Hosts", systemImage: "desktopcomputer", value: SettingsTab.hosts) { HostsSettingsTab() }
      Tab("Advanced", systemImage: "slider.horizontal.3", value: SettingsTab.advanced) {
        AdvancedSettingsTab()
      }
    }
    .frame(minWidth: 640, idealWidth: 720, minHeight: 480, idealHeight: 620)
    .environment(host)
    .safeAreaInset(edge: .top) { FocusedHostBanner() }
    // Settings that live on a host are the shown host's.
    .task(id: SettingsLoadKey(ready: model.store.connection == .ready, host: model.hosts.focused)) {
      guard model.store.connection == .ready else { return }
      host.backend = model.backend
      await host.load()
    }
    .themed()
  }
}

enum SettingsTab: String, Hashable, CaseIterable {
  case general, accounts, agents, llm, mcp, tools, git, remote, hosts, advanced

  var title: String {
    switch self {
    case .general: "General"
    case .accounts: "Accounts"
    case .agents: "Agents"
    case .llm: "LLM"
    case .mcp: "MCP"
    case .tools: "Tools"
    case .git: "Git"
    case .remote: "Remote"
    case .hosts: "Hosts"
    case .advanced: "Advanced"
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
        Text("Showing \(model.hosts.label(model.hosts.focused))'s settings. Remote access and Hosts are always this Mac's.")
        Spacer()
        Button("Show This Mac") { model.hosts.focus(Hosts.local) }
      }
      .font(.callout)
      .padding(.horizontal, 12)
      .padding(.vertical, 6)
      .background(theme.warningSoft)
    }
  }
}
