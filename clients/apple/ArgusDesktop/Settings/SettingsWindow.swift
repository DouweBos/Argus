import SwiftUI

/// App Settings (⌘,): every field in `docs/app-settings.md`, one tab per area.
struct SettingsWindow: View {
  @Environment(DesktopModel.self) private var model

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
      Tab("Remote", systemImage: "antenna.radiowaves.left.and.right", value: SettingsTab.remote) {
        RemoteSettingsTab()
      }
      Tab("Advanced", systemImage: "slider.horizontal.3", value: SettingsTab.advanced) {
        AdvancedSettingsTab()
      }
    }
    .frame(minWidth: 640, idealWidth: 720, minHeight: 480, idealHeight: 620)
    .themed()
  }
}

enum SettingsTab: String, Hashable, CaseIterable {
  case general, accounts, agents, llm, mcp, tools, remote, advanced
}
