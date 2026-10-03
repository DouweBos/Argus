import ArgusCore
import ArgusUI
import SwiftUI

struct McpServersSection: View {
  @Binding var draft: ArgusConfigDraft
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  @State private var inherited: [ArgusProtocol.InheritedMcpServer]?

  var body: some View {
    SectionIntro(
      title: "Project MCP servers",
      text: "MCP servers shared with the team via .argus.json. Merged on top of plugin servers, ~/.claude.json, .mcp.json, and your personal app-level servers."
    )
    if let inherited, !inherited.isEmpty {
      Section("Inherited") {
        ForEach(inherited, id: \.name) { server in
          LabeledContent(server.name) {
            Text(server.source).font(.caption).foregroundStyle(theme.textMuted)
          }
        }
      }
    }
    ForEach($draft.mcpServers) { $server in
      Section {
        TextField("Name", text: $server.name, prompt: Text("filesystem"))
        TextEditor(text: $server.json)
          .font(.system(.callout, design: .monospaced))
          .frame(minHeight: 90)
        if let error = server.error {
          Text(error).font(.caption).foregroundStyle(theme.error)
        }
      } header: {
        HStack {
          Text(server.name.isEmpty ? "New server" : server.name)
          Spacer()
          RemoveButton { draft.mcpServers.removeAll { $0.id == server.id } }
        }
      }
    }
    Section {
      if draft.mcpServers.isEmpty { Text("No project MCP servers").foregroundStyle(theme.textMuted) }
      AddButton("Add server") { draft.mcpServers.append(.init()) }
    } footer: {
      Text(#"Each config is .mcp.json-style: { "command", "args", "env" } or { "url", "headers" }."#)
    }
    .task {
      guard let backend = model.backend, let repo = model.projectSettingsRepo else { return }
      inherited = try? await backend.request(
        ArgusProtocol.Commands.ListInheritedMcpServers.self, .init(worktreePath: repo))
    }
  }
}

struct ProjectAutomationsSection: View {
  @Binding var draft: ArgusConfigDraft

  private static let labels = ["propose": "Propose", "draft": "Draft", "pr": "Pull request", "auto_merge": "Auto-merge"]
  private static let captions = [
    "propose": "Put it in the inbox and touch nothing.",
    "draft": "Open a worktree, implement it, commit — then stop.",
    "pr": "Also push the branch and open a draft pull request.",
    "auto_merge": "Also merge it once CI is green. Opt-in only.",
  ]

  var body: some View {
    SectionIntro(
      title: "Automations",
      text: "How far Argus automations may go in this repository. Saved to .argus.json and shared with the team. These limits only ever tighten what the app allows."
    )
    Section {
      Picker("Autonomy ceiling", selection: $draft.autonomyCeiling) {
        Text("No ceiling").tag(String?.none)
        ForEach(ArgusConfigDraft.autonomyLevels, id: \.self) { Text(Self.labels[$0] ?? $0).tag(String?.some($0)) }
      }
      .pickerStyle(.segmented)
    } footer: {
      Text(
        draft.autonomyCeiling.map { "Highest rung any automation reaches here. \(Self.captions[$0] ?? "")" }
          ?? "No repo-level cap — automations run at whatever the app and their own setting allow.")
    }
    Section {
      TextField("Path denylist", text: $draft.automationPathDenylist, prompt: Text("infra/**, **/migrations/**"))
    } footer: {
      Text("Comma-separated globs no automation-started branch may touch. Added to each automation's own list.")
    }
    Section {
      TextField(
        "Disabled automations", text: $draft.disabledAutomations, prompt: Text("regression-sweep, take-the-easy-ones")
      )
    } footer: {
      Text("Comma-separated automation ids or template ids this repo opts out of entirely, e.g. regression-sweep.")
    }
  }
}

struct ProjectToolsSection: View {
  @Binding var draft: ArgusConfigDraft

  var body: some View {
    SectionIntro(
      title: "Disabled tools",
      text: "Disable tools for everyone working on this project. Saved to .argus.json so the mask travels with the repo. Cannot force-enable tools your team members have turned off."
    )
    Section {
      ForEach(ArgusConfigDraft.tools, id: \.id) { tool in
        Toggle(isOn: disabled(tool.id)) {
          Text(tool.name)
          Text(tool.description)
        }
      }
    }
  }

  private func disabled(_ id: String) -> Binding<Bool> {
    Binding(
      get: { draft.disabledTools.contains(id) },
      set: { on in
        draft.disabledTools.removeAll { $0 == id }
        if on { draft.disabledTools.append(id) }
      })
  }
}

struct JSONPreviewSection: View {
  let settings: ProjectSettingsModel

  var body: some View {
    SectionIntro(title: "JSON preview", text: "Read-only view of what will be written to .argus.json on save.")
    Section {
      Text(settings.previewJSON)
        .font(.system(size: 12, design: .monospaced))
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
      Button("Copy") {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(settings.previewJSON, forType: .string)
      }
    }
  }
}
