import ArgusCore
import SwiftUI

/// Personal MCP servers merged into every agent on this machine, and the ones
/// agents already inherit from Claude Code, plugins and `.mcp.json`.
struct MCPSettingsTab: View {
  @Environment(HostSettingsModel.self) private var host
  @State private var entries: [McpServerEntry] = []
  @State private var inherited: [ArgusProtocol.InheritedMcpServer]?
  @State private var saved = false

  var body: some View {
    Form {
      Section {
        if !host.loaded {
          SettingsLoading()
        } else if entries.isEmpty {
          Text("No personal MCP servers").foregroundStyle(.secondary)
        }
        ForEach($entries) { $entry in
          McpServerRow(entry: $entry) { entries.removeAll { $0.id == entry.id } }
        }
        HStack {
          Button("Add Server", systemImage: "plus") { entries.append(McpServerEntry()) }
          Spacer()
          Button(saved ? "Saved" : "Save", action: save)
            .buttonStyle(.borderedProminent)
            .disabled(!host.loaded || !McpServerEntry.allValid(entries))
        }
      } header: {
        Text("MCP servers")
      } footer: {
        SettingsCaption(
          "Personal MCP servers merged into every Argus agent on this machine. Stored in "
            + "~/.argus/app-settings.json. Use project settings for entries the whole team should get.")
      }

      Section {
        if let inherited {
          if inherited.isEmpty {
            Text("No servers inherited from Claude Code, plugins, or this project's .mcp.json.")
              .foregroundStyle(.secondary)
          }
          ForEach(Array(inherited.enumerated()), id: \.offset) { _, server in
            InheritedMcpRow(server: server, backend: host.backend)
          }
        } else {
          SettingsLoading()
        }
      } header: {
        Text("Inherited")
      } footer: {
        SettingsCaption(
          "Argus already passes these servers through to every agent — listed for reference, not editable here.")
      }

      Section { SettingsError(text: host.error) }
    }
    .formStyle(.grouped)
    .task(id: host.loaded) {
      guard host.loaded else { return }
      entries = McpServerEntry.entries(from: host.settings?.mcpServers)
      inherited =
        await host.run(ArgusProtocol.Commands.ListInheritedMcpServers.self, .init()) ?? []
    }
  }

  private func save() {
    let map = McpServerEntry.map(from: entries)
    let value: JSONValue = .object(map.mapValues { .object($0) })
    Task {
      await host.save(.mcpServers, ["mcp_servers": value]) { $0.mcpServers = map }
      guard host.error == nil else { return }
      saved = true
      try? await Task.sleep(for: .seconds(1.5))
      saved = false
    }
  }
}

/// One editable server: name, JSON config with live validation, and a probe.
private struct McpServerRow: View {
  @Environment(HostSettingsModel.self) private var host
  @Binding var entry: McpServerEntry
  let remove: () -> Void
  @State private var probe = McpProbe()

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        McpStatusDot(status: probe.status)
        TextField("Name", text: $entry.name, prompt: Text("Server name (e.g. filesystem)"))
          .labelsHidden()
        Button("Remove", action: remove)
      }
      TextEditor(text: $entry.json)
        .font(.scaled(.body).monospaced())
        .frame(minHeight: 96)
        .scrollContentBackground(.hidden)
        .autocorrectionDisabled()
        .accessibilityLabel("MCP server JSON config")
        .onChange(of: entry.json) { _, typed in
          let straight = McpServerEntry.straighteningQuotes(typed)
          if straight != typed { entry.json = straight }
        }
      SettingsError(text: entry.error)
      McpProbeControls(backend: host.backend, probe: probe, config: entry.config, url: entry.url)
    }
    .padding(.vertical, 4)
  }
}

/// Shared with Project Settings, which lists the same servers for its repo.
struct InheritedMcpRow: View {
  let server: ArgusProtocol.InheritedMcpServer
  let backend: HostRouter?
  @State private var probe = McpProbe()

  private var url: String? {
    if case .string(let url)? = server.config["url"] { return url }
    return nil
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        McpStatusDot(status: probe.status)
        Text(server.name)
        Text(server.source).font(.scaled(.caption)).foregroundStyle(.secondary)
        Spacer()
      }
      McpProbeControls(backend: backend, probe: probe, config: server.config, url: url)
    }
    // Every inherited row is checked on sight, as on the desktop.
    .task { await probe.test(server.config, backend: backend, track: false) }
  }
}
