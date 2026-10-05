import ArgusCore
import ArgusUI
import SwiftUI

/// The bundled device tools, each with its machine prereqs checked live, and
/// the conductor version agents drive devices with.
struct ToolsSettingsTab: View {
  @Environment(HostSettingsModel.self) private var host
  @State private var toggles: [String: Bool]?

  var body: some View {
    Form {
      Section {
        if let toggles {
          ForEach(DesktopTool.all) { tool in
            ToolRow(tool: tool, toggles: toggles) { set(tool.id, $0) }
          }
        } else {
          SettingsLoading()
        }
      } header: {
        Text("Device")
      } footer: {
        SettingsCaption("Turn off the tools you don't use to keep Argus's UI focused.")
      }
      ConductorVersionSection()
      Section { SettingsError(text: host.error) }
    }
    .formStyle(.grouped)
    .task(id: host.loaded) {
      guard host.backend != nil else { return }
      toggles = await host.run(ArgusProtocol.Commands.GetEnabledTools.self, EmptyParams()) ?? [:]
    }
  }

  private func set(_ id: String, _ on: Bool) {
    var next = toggles ?? [:]
    next[id] = on
    toggles = next
    Task {
      await host.run(ArgusProtocol.Commands.SetEnabledTools.self, .init(userEnabled: next))
      MacTelemetry.capture(.settingsChanged(setting: .toolToggled))
    }
  }
}

private struct ToolRow: View {
  @Environment(\.theme) private var theme
  let tool: DesktopTool
  let toggles: [String: Bool]
  let set: (Bool) -> Void

  var body: some View {
    let on = DesktopTool.userEnabled(tool.id, in: toggles)
    let missing = on ? DesktopTool.missingRequirements(tool.id, in: toggles) : []
    VStack(alignment: .leading, spacing: 6) {
      Toggle(isOn: Binding(get: { on }, set: set)) {
        VStack(alignment: .leading, spacing: 2) {
          Text(tool.name)
          SettingsCaption(tool.description)
          if !missing.isEmpty {
            Text("Needs: \(missing.joined(separator: ", "))").font(.scaled(.caption)).foregroundStyle(theme.warning)
          }
        }
      }
      // Checks only run for tooling you've turned on.
      if on, !tool.prereqs.isEmpty {
        PrereqListView(ids: tool.prereqs)
      }
    }
  }
}
