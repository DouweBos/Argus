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
      // Git settings: M4
      Tab("Remote", systemImage: "antenna.radiowaves.left.and.right", value: SettingsTab.remote) {
        RemoteSettingsTab()
      }
      Tab("Advanced", systemImage: "slider.horizontal.3", value: SettingsTab.advanced) {
        AdvancedSettingsTab()
      }
    }
    .frame(minWidth: 640, idealWidth: 720, minHeight: 480, idealHeight: 620)
    .environment(host)
    .task(id: model.backend == nil) {
      host.backend = model.backend
      await host.load()
    }
    .themed()
  }
}

enum SettingsTab: String, Hashable, CaseIterable {
  case general, accounts, agents, llm, mcp, tools, remote, advanced

  var title: String {
    switch self {
    case .general: "General"
    case .accounts: "Accounts"
    case .agents: "Agents"
    case .llm: "LLM"
    case .mcp: "MCP"
    case .tools: "Tools"
    case .remote: "Remote"
    case .advanced: "Advanced"
    }
  }
}
